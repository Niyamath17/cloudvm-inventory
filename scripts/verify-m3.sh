#!/usr/bin/env bash
# CloudVM – M3 verification (persistence, reconciliation, locking, inventory API)
#
# 1. Prepares a separate TEST database (cloudvm_test) – integration tests truncate it,
#    the development database (cloudvm) is never truncated.
# 2. Runs the full test suite.
# 3. Demonstrates the real API against the development database: two MOCK collections
#    (the second must be 58 unchanged), concurrent start (one 202, one 409), dashboard.
#
# Usage (from the project root):   bash scripts/verify-m3.sh

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/m3-verification.log"
: > "$LOG"
# shellcheck source=lib/verify-common.sh
source "$ROOT/scripts/lib/verify-common.sh"

{
  echo "CloudVM M3 verification – $(date)"
  echo "OS: $(uname -sm)   node: $(node -v 2>/dev/null)   npm: $(npm -v 2>/dev/null)   docker: ${DOCKER:-NOT FOUND}"
} | tee -a "$LOG"

API="http://localhost:4000/api/v1"
DEV_URL="$(env_value "$ROOT/backend/.env" DATABASE_URL)"
# Same rule as tests/helpers/test-db.ts: append "_test" to the database name.
TEST_URL="$(node -e 'const u=new URL(process.argv[1]); u.pathname=u.pathname.replace(/\/$/,"")+"_test"; console.log(u.toString())' "$DEV_URL")"
PGUSER_="$(env_value "$ROOT/.env" POSTGRES_USER)"
TEST_DB="$(env_value "$ROOT/.env" POSTGRES_DB)_test"

# json <expression>  – evaluates a JS expression against JSON on stdin (no jq needed)
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }

step "Config consistency"                          check_config
step "Postgres container healthy"                  check_postgres_container

cd "$ROOT/backend"
step "Backend npm install (+prisma generate)"      npm install --no-audit --no-fund
step "Dev DB: migrate status (schema unchanged)"   npx prisma migrate status

prepare_test_db() {
  local exists
  exists=$("$DOCKER" exec cloudvm-postgres psql -U "$PGUSER_" -d postgres -Atc "select 1 from pg_database where datname='$TEST_DB'")
  if [ "$exists" != "1" ]; then
    echo "Creating database $TEST_DB"
    "$DOCKER" exec cloudvm-postgres createdb -U "$PGUSER_" "$TEST_DB" || return 1
  else
    echo "Database $TEST_DB exists"
  fi
  DATABASE_URL="$TEST_URL" npx prisma migrate deploy
}
step "Test DB: create + migrate ($TEST_DB)"        prepare_test_db

step "Backend typecheck (tsc --noEmit)"            npm run typecheck
step "Backend build (tsc -> dist)"                 npm run build
step "Account-level reconciliation regression (verbose)" npx vitest run tests/unit/reconciliation.test.ts tests/unit/normalization/accounts.test.ts tests/integration/collection.test.ts --reporter=verbose
step "Full backend test suite (unit + DB)"         npm test

SERVER_PID=""
start_server() {
  if lsof -nP -iTCP:4000 -sTCP:LISTEN >/dev/null 2>&1; then echo "Port 4000 already in use – stop the other process first"; return 1; fi
  (cd "$ROOT/backend" && NODE_ENV=production node dist/index.js > "$ROOT/verify-backend-server.log" 2>&1) &
  SERVER_PID=$!
  for _ in $(seq 1 30); do sleep 0.5; curl -s -o /dev/null "$API/health" && return 0; done
  echo "server did not start"; return 1
}
stop_server() { [ -n "$SERVER_PID" ] && { pkill -P "$SERVER_PID" 2>/dev/null; kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; }; SERVER_PID=""; }

# POST /collections, wait for completion, print the run summary. Echoes the final run JSON to $RUN_JSON.
RUN_JSON=""
collect_once() {
  local body id status
  body=$(curl -s -X POST "$API/collections")
  echo "POST /collections -> $body"
  id=$(echo "$body" | json 'j.runId') || return 1
  for _ in $(seq 1 60); do
    RUN_JSON=$(curl -s "$API/collections/$id")
    status=$(echo "$RUN_JSON" | json 'j.status')
    [ "$status" != "RUNNING" ] && break
    sleep 0.5
  done
  echo "$RUN_JSON" | json '`run ${j.id}: ${j.status} discovered=${j.discoveredCount} created=${j.createdCount} updated=${j.updatedCount} unchanged=${j.unchangedCount} decommissioned=${j.decommissionedCount} invalid=${j.invalidCount}\n` + j.providerResults.map(p=>`  ${p.provider.padEnd(8)} ${p.dataSource} ${p.status} vms=${p.vmCount} invalid=${p.invalidCount} ${p.durationMs}ms`).join("\n")'
}

api_demo() {
  start_server || return 1
  local code=0
  echo "--- Collection #1 (dev database)"
  collect_once || code=1
  echo "--- Collection #2 (must be idempotent: 58 unchanged, 0 created/updated/decommissioned)"
  collect_once || code=1
  echo "$RUN_JSON" | json 'j.status==="SUCCESS" && j.unchangedCount===58 && j.createdCount===0 && j.updatedCount===0 && j.decommissionedCount===0' | grep -qx true \
    && echo "=> idempotency OK" || { echo "=> idempotency FAILED"; code=1; }

  echo "--- Concurrent start: two POSTs at once (expect one 202 and one 409)"
  local a b pa pb
  curl -s -o /tmp/cvm_a.json -w '%{http_code}' -X POST "$API/collections" > /tmp/cvm_a.code & pa=$!
  curl -s -o /tmp/cvm_b.json -w '%{http_code}' -X POST "$API/collections" > /tmp/cvm_b.code & pb=$!
  wait "$pa" "$pb"
  a=$(cat /tmp/cvm_a.code); b=$(cat /tmp/cvm_b.code)
  echo "responses: $a $(cat /tmp/cvm_a.json)"
  echo "           $b $(cat /tmp/cvm_b.json)"
  [ "$(printf '%s\n%s\n' "$a" "$b" | sort | tr '\n' ' ')" = "202 409 " ] && echo "=> locking OK" || { echo "=> locking FAILED"; code=1; }
  sleep 3

  echo "--- GET /dashboard/summary"
  curl -s "$API/dashboard/summary" | json 'JSON.stringify({dataSource:j.dataSource, vms:j.vms, resources:j.resources, lastCollection:j.lastCollection.status})'
  echo "--- GET /vms?provider=PROXMOX&sortBy=memoryMb&sortOrder=desc&pageSize=3"
  curl -s "$API/vms?provider=PROXMOX&sortBy=memoryMb&sortOrder=desc&pageSize=3" | json 'JSON.stringify(j.pagination)+"\n"+j.data.map(v=>`  ${v.name} ${v.externalId} ${v.memoryMb}MiB ${v.powerState}`).join("\n")'
  echo "--- GET /vms?lifecycle=DECOMMISSIONED"
  curl -s "$API/vms?lifecycle=DECOMMISSIONED" | json 'j.data.map(v=>`  ${v.name} ${v.decommissionReason} raw=${v.rawPowerState}`).join("\n")'
  echo "--- GET /vms?provider=ORACLE (expect 400)"
  curl -s -w '\nHTTP %{http_code}\n' "$API/vms?provider=ORACLE"
  echo "--- GET /providers"
  curl -s "$API/providers" | json 'j.data.map(p=>`  ${p.provider} ${p.dataSource} active=${p.vmCounts.active} last=${p.lastResult?.status}`).join("\n")'

  stop_server
  return $code
}
step "Live API demo (dev DB): collect x2, lock, queries" api_demo

print_summary
