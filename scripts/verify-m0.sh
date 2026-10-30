#!/usr/bin/env bash
# CloudVM – M0 verification script
#
# Runs every remaining M0 check in order and writes the full output to
# m0-verification.log (git-ignored via *.log). It does NOT stop at the first
# failure, so one run shows every problem. Secrets are never printed.
#
# Usage (from the project root):   bash scripts/verify-m0.sh

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/m0-verification.log"
cd "$ROOT"
: > "$LOG"

declare -a RESULTS=()
step() {  # step "<label>" <command...>
  local label="$1"; shift
  printf '\n==================== %s ====================\n$ %s\n' "$label" "$*" | tee -a "$LOG"
  "$@" 2>&1 | tee -a "$LOG"
  local code=${PIPESTATUS[0]}
  RESULTS+=("$(printf '%-38s %s' "$label" "$([ "$code" -eq 0 ] && echo PASS || echo "FAIL (exit $code)")")")
  return 0
}

mask() { sed -E 's#(://[^:]+:)[^@]+@#\1****@#'; }

# Locate the Docker CLI. On macOS, Docker Desktop's CLI is not always on the PATH
# of non-login shells (e.g. `bash script.sh` started from some terminals/IDEs),
# so fall back to the locations Docker Desktop installs it to.
find_docker() {
  local candidate
  for candidate in \
    "$(command -v docker 2>/dev/null)" \
    "$HOME/.docker/bin/docker" \
    /usr/local/bin/docker \
    /opt/homebrew/bin/docker \
    /Applications/Docker.app/Contents/Resources/bin/docker; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}
DOCKER="$(find_docker || true)"

{
  echo "CloudVM M0 verification – $(date)"
  echo "OS: $(uname -sm)   node: $(node -v 2>/dev/null)   npm: $(npm -v 2>/dev/null)"
  if [ -n "$DOCKER" ]; then
    echo "docker: $("$DOCKER" --version 2>/dev/null)  ($DOCKER)"
  else
    echo "docker: NOT FOUND on PATH or in Docker Desktop's default locations"
  fi
} | tee -a "$LOG"

# 1-2. Configuration consistency (root .env vs backend/.env) ----------------------
check_config() {
  [ -f .env ] || { echo "root .env missing"; return 1; }
  [ -f backend/.env ] || { echo "backend/.env missing"; return 1; }
  local port user db url
  port=$(grep -E '^POSTGRES_PORT=' .env | cut -d= -f2)
  user=$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2)
  db=$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2)
  pass=$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2)
  url=$(grep -E '^DATABASE_URL=' backend/.env | cut -d= -f2-)
  echo "root .env     : user=$user db=$db port=$port"
  echo "backend/.env  : $(echo "$url" | mask)"
  local expected="postgresql://$user:$pass@localhost:$port/$db"
  case "$url" in
    "$expected"*) echo "OK: DATABASE_URL matches root .env (user, password, port, database)";;
    *) echo "MISMATCH: DATABASE_URL does not match root .env"; return 1;;
  esac
}
step "1-2 Config consistency" check_config
check_postgres_container() {
  [ -n "$DOCKER" ] || { echo "Docker CLI not found – is Docker Desktop installed and running?"; return 1; }
  "$DOCKER" info >/dev/null 2>&1 || { echo "Docker CLI found ($DOCKER) but the Docker engine is not running – start Docker Desktop"; return 1; }
  "$DOCKER" compose ps postgres
  local health
  health=$("$DOCKER" inspect --format '{{.State.Health.Status}}' cloudvm-postgres 2>/dev/null)
  echo "cloudvm-postgres health: ${health:-not found}"
  [ "$health" = "healthy" ]
}
step "Postgres container healthy" check_postgres_container

# 3-6. Backend ---------------------------------------------------------------------
cd "$ROOT/backend"
step "Backend npm install (+prisma generate)" npm install --no-audit --no-fund
step "3  Prisma validate schema" npx prisma validate
step "3  Prisma generate client" npx prisma generate
# In M0 the schema has no models, so there are no migrations yet (the first one,
# `init`, is created in M1). `prisma migrate status` exits 1 in that case, which is
# EXPECTED here. We only fail if Prisma could not reach the database or reports
# anything other than "no migrations yet" / "up to date".
check_migrate_status() {
  local out code
  out=$(npx prisma migrate status 2>&1); code=$?
  echo "$out"
  if [ "$code" -eq 0 ]; then
    return 0
  fi
  if echo "$out" | grep -qE "P1001|Can't reach database"; then
    echo "=> FAIL: Prisma could not reach the database"; return 1
  fi
  if [ ! -d prisma/migrations ] && echo "$out" | grep -q "No migration found in prisma/migrations"; then
    echo "=> EXPECTED for M0: database reachable, no migrations exist yet (created in M1). Not creating an empty migration."
    return 0
  fi
  echo "=> FAIL: unexpected migrate status"; return 1
}
step "4  Prisma migrate status (M0: none expected)" check_migrate_status
step "5  Backend typecheck (tsc --noEmit)" npm run typecheck
step "5  Backend build (tsc -> dist)" npm run build
step "6  Backend tests (vitest)" npm test
step "9a DB connectivity script (db:check)" npm run db:check

# 7. Frontend ----------------------------------------------------------------------
cd "$ROOT/frontend"
step "Frontend npm install" npm install --no-audit --no-fund
step "7  Frontend production build" npm run build

# 8-9. Start backend, call /health, stop it ---------------------------------------
cd "$ROOT/backend"
health_check() {
  if lsof -nP -iTCP:4000 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 4000 already in use – stop the other process first"; return 1
  fi
  NODE_ENV=production node dist/index.js > "$ROOT/m0-backend-server.log" 2>&1 &
  local pid=$!
  local code=1
  for _ in $(seq 1 20); do
    sleep 0.5
    if curl -s -o /tmp/cloudvm-health.json -w '%{http_code}' http://localhost:4000/api/v1/health > /tmp/cloudvm-health.code 2>/dev/null; then
      break
    fi
  done
  echo "HTTP status: $(cat /tmp/cloudvm-health.code 2>/dev/null)"
  python3 -m json.tool /tmp/cloudvm-health.json 2>/dev/null || cat /tmp/cloudvm-health.json
  grep -q '"status": *"ok"' /tmp/cloudvm-health.json && grep -q '"database": *{[^}]*"status": *"up"' /tmp/cloudvm-health.json && code=0
  echo "--- unknown route (expect JSON 404):"
  curl -s -w '\nHTTP %{http_code}\n' http://localhost:4000/api/v1/nope
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  echo "--- backend server log (JSON, first 20 lines):"
  head -20 "$ROOT/m0-backend-server.log"
  return $code
}
step "8-9 Start backend + GET /api/v1/health" health_check

# Summary ---------------------------------------------------------------------------
{
  printf '\n==================== SUMMARY ====================\n'
  printf '%s\n' "${RESULTS[@]}"
  echo "Full log: $LOG"
} | tee -a "$LOG"
