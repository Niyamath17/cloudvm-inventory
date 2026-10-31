#!/usr/bin/env bash
# CloudVM – M4 verification (NetBox synchronization – SIMULATION mode)
#
# 1. Test DB prepare/migrate, typecheck, build, sync tests (verbose), full suite.
# 2. Live API demo on the dev database, SIMULATION mode only:
#    collect -> sync -> sync again (must be 0 created/updated) -> /netbox/status.
#
# Usage (from the project root):   bash scripts/verify-m4.sh

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/m4-verification.log"
: > "$LOG"
# shellcheck source=lib/verify-common.sh
source "$ROOT/scripts/lib/verify-common.sh"

{
  echo "CloudVM M4 verification – $(date)"
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
step "NetBox sync tests (verbose)"                  npx vitest run tests/unit/sync tests/integration/sync.test.ts tests/integration/sync-api.test.ts --reporter=verbose
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

# POST /sync, wait, print the summary into $SYNC_JSON
SYNC_JSON=""
sync_once() {
  local body id status
  body=$(curl -s -X POST "$API/sync")
  echo "POST /sync -> $body"
  id=$(echo "$body" | json 'j.syncRunId') || return 1
  for _ in $(seq 1 60); do
    SYNC_JSON=$(curl -s "$API/sync/runs/$id")
    status=$(echo "$SYNC_JSON" | json 'j.status')
    [ "$status" != "RUNNING" ] && break
    sleep 0.5
  done
  echo "$SYNC_JSON" | json '`sync ${j.id}: target=${j.target} ${j.status} created=${j.createdCount} updated=${j.updatedCount} decommissioned=${j.decommissionedCount} skipped=${j.skippedCount} failed=${j.failedCount} duplicate=${j.duplicateCount}\n  ${j.label}`'
}

api_demo() {
  start_server || return 1
  local code=0
  echo "--- GET /netbox/status"
  curl -s "$API/netbox/status"; echo
  echo "--- Collection (dev database, MOCK data)"
  collect_once || code=1
  echo "--- Sync #1 (SIMULATION)"
  sync_once || code=1
  echo "$SYNC_JSON" | json 'j.target==="SIMULATION" && (j.status==="SUCCESS")' | grep -qx true && echo "=> sync #1 OK (SIMULATION)" || { echo "=> sync #1 FAILED"; code=1; }
  echo "--- Sync #2 (must be idempotent: 0 created / 0 updated / 0 decommissioned / 0 failed)"
  sync_once || code=1
  echo "$SYNC_JSON" | json 'j.status==="SUCCESS" && j.createdCount===0 && j.updatedCount===0 && j.decommissionedCount===0 && j.failedCount===0 && j.skippedCount===58' | grep -qx true \
    && echo "=> sync idempotency OK (58 skipped)" || { echo "=> sync idempotency FAILED"; code=1; }
  echo "--- Concurrent POST /sync x2 (expect one 202 and one 409)"
  local a b pa pb
  curl -s -o /tmp/cvm_sa.json -w '%{http_code}' -X POST "$API/sync" > /tmp/cvm_sa.code & pa=$!
  curl -s -o /tmp/cvm_sb.json -w '%{http_code}' -X POST "$API/sync" > /tmp/cvm_sb.code & pb=$!
  wait "$pa" "$pb"
  a=$(cat /tmp/cvm_sa.code); b=$(cat /tmp/cvm_sb.code)
  echo "responses: $a / $b"
  [ "$(printf '%s\n%s\n' "$a" "$b" | sort | tr '\n' ' ')" = "202 409 " ] && echo "=> sync locking OK" || { echo "=> sync locking FAILED"; code=1; }
  sleep 2
  echo "--- GET /netbox/simulated-vms (first 5)"
  curl -s "$API/netbox/simulated-vms?pageSize=5" | json 'j.label+"\n"+JSON.stringify(j.pagination)+"\n"+j.data.map(v=>`  #${v.id} ${v.name} [${v.clusterName}] ${v.status} serial=${v.serial} vcpus=${v.vcpus} mem=${v.memory}MB disk=${v.disk}MB`).join("\n")'
  echo "--- GET /dashboard/summary (lastSync)"
  curl -s "$API/dashboard/summary" | json 'JSON.stringify(j.lastSync)'
  stop_server
  return $code
}
step "Live API demo (dev DB): collect, sync x2, lock" api_demo

print_summary
