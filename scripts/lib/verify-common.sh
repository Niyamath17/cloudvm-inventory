#!/usr/bin/env bash
# Shared helpers for scripts/verify-m*.sh (M1 onwards).
# verify-m0.sh is intentionally left unchanged (it is the verified M0 baseline).
#
# Expects the caller to set: ROOT, LOG. Provides: step, mask, DOCKER,
# check_config, check_postgres_container, health_check, print_summary.

declare -a RESULTS=()

# step "<label>" <command...>  – runs a command, tees output to $LOG, records PASS/FAIL, never aborts.
step() {
  local label="$1"; shift
  printf '\n==================== %s ====================\n$ %s\n' "$label" "$*" | tee -a "$LOG"
  "$@" 2>&1 | tee -a "$LOG"
  local code=${PIPESTATUS[0]}
  RESULTS+=("$(printf '%-46s %s' "$label" "$([ "$code" -eq 0 ] && echo PASS || echo "FAIL (exit $code)")")")
  return 0
}

mask() { sed -E 's#(://[^:]+:)[^@]+@#\1****@#g'; }

# Docker Desktop's CLI is not always on the PATH of non-login shells on macOS.
find_docker() {
  local candidate
  for candidate in \
    "$(command -v docker 2>/dev/null)" \
    "$HOME/.docker/bin/docker" \
    /usr/local/bin/docker \
    /opt/homebrew/bin/docker \
    /Applications/Docker.app/Contents/Resources/bin/docker; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then echo "$candidate"; return 0; fi
  done
  return 1
}
DOCKER="$(find_docker || true)"

env_value() { grep -E "^$2=" "$1" | head -1 | cut -d= -f2-; }   # env_value <file> <KEY>

check_config() {
  [ -f "$ROOT/.env" ] || { echo "root .env missing"; return 1; }
  [ -f "$ROOT/backend/.env" ] || { echo "backend/.env missing"; return 1; }
  local port user db pass url
  port=$(env_value "$ROOT/.env" POSTGRES_PORT); user=$(env_value "$ROOT/.env" POSTGRES_USER)
  db=$(env_value "$ROOT/.env" POSTGRES_DB);     pass=$(env_value "$ROOT/.env" POSTGRES_PASSWORD)
  url=$(env_value "$ROOT/backend/.env" DATABASE_URL)
  echo "root .env     : user=$user db=$db port=$port"
  echo "backend/.env  : $(echo "$url" | mask)"
  case "$url" in
    "postgresql://$user:$pass@localhost:$port/$db"*) echo "OK: DATABASE_URL matches root .env";;
    *) echo "MISMATCH: DATABASE_URL does not match root .env"; return 1;;
  esac
}

check_postgres_container() {
  [ -n "$DOCKER" ] || { echo "Docker CLI not found – is Docker Desktop installed?"; return 1; }
  "$DOCKER" info >/dev/null 2>&1 || { echo "Docker engine not running – start Docker Desktop"; return 1; }
  (cd "$ROOT" && "$DOCKER" compose ps postgres)
  local health
  health=$("$DOCKER" inspect --format '{{.State.Health.Status}}' cloudvm-postgres 2>/dev/null)
  echo "cloudvm-postgres health: ${health:-not found}"
  [ "$health" = "healthy" ]
}

# Starts the built backend, checks /api/v1/health = 200 + database up, stops it.
health_check() {
  if lsof -nP -iTCP:4000 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port 4000 already in use – stop the other process first"; return 1
  fi
  (cd "$ROOT/backend" && NODE_ENV=production node dist/index.js > "$ROOT/verify-backend-server.log" 2>&1) &
  local pid=$! code=1 body status
  for _ in $(seq 1 20); do
    sleep 0.5
    status=$(curl -s -o /tmp/cloudvm-health.json -w '%{http_code}' http://localhost:4000/api/v1/health 2>/dev/null) && break
  done
  body=$(cat /tmp/cloudvm-health.json 2>/dev/null)
  echo "HTTP status: $status"
  echo "$body"
  echo "$body" | grep -q '"status":"ok"' && echo "$body" | grep -q '"database":{"status":"up"' && code=0
  pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  return $code
}

print_summary() {
  {
    printf '\n==================== SUMMARY ====================\n'
    printf '%s\n' "${RESULTS[@]}"
    echo "Full log: $LOG"
  } | tee -a "$LOG"
}
