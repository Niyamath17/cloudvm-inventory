#!/usr/bin/env bash
# CloudVM – M5 verification (drift detection & reporting – SIMULATION mode)
#
# 1. Test DB prepare/migrate, typecheck, build, drift tests (verbose), full suite.
# 2. Live demo on the dev database, SIMULATION mode only:
#    collect -> sync -> drift report (0) -> introduce 5 differences in the SIMULATED NetBox table
#    -> drift report (5) -> remediate + sync -> operator removes orphan/duplicate -> drift report (0).
#
# Usage (from the project root):   bash scripts/verify-m5.sh

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/m5-verification.log"
: > "$LOG"
# shellcheck source=lib/verify-common.sh
source "$ROOT/scripts/lib/verify-common.sh"

{
  echo "CloudVM M5 verification – $(date)"
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
step "Drift tests (verbose)"                        npx vitest run tests/unit/drift tests/integration/drift.test.ts tests/integration/drift-api.test.ts --reporter=verbose
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

DEV_DB="$(env_value "$ROOT/.env" POSTGRES_DB)"
# SQL against the SIMULATED NetBox table in the dev database (never a real NetBox).
simsql() { "$DOCKER" exec -i cloudvm-postgres psql -U "$PGUSER_" -d "$DEV_DB" -v ON_ERROR_STOP=1 -q -c "$1"; }

DRIFT_JSON=""
drift_report() {
  DRIFT_JSON=$(curl -s -X POST "$API/drift/reports")
  echo "$DRIFT_JSON" | json '`report ${j.id}: target=${j.target} total=${j.totalItems}\n  ${j.label}\n  byType=${JSON.stringify(j.summary.byType)}\n  bySeverity=${JSON.stringify(j.summary.bySeverity)}`'
  local id; id=$(echo "$DRIFT_JSON" | json 'j.id')
  curl -s "$API/drift/reports/$id" | json 'j.items.map(i=>`    [${i.severity}] ${i.type} ${i.name} ${i.field??""} expected=${i.expected??"-"} actual=${i.actual??"-"}`).join("\n")'
}

api_demo() {
  start_server || return 1
  local code=0
  echo "--- Collection + sync (dev database, MOCK data, SIMULATION)"
  collect_once || code=1
  sync_once || code=1

  echo "--- Drift report #1 (expect 0 findings)"
  drift_report
  echo "$DRIFT_JSON" | json 'j.target==="SIMULATION" && j.totalItems===0' | grep -qx true && echo "=> baseline OK (0 findings)" || { echo "=> baseline NOT clean"; code=1; }

  echo "--- Introducing 5 deliberate differences in the SIMULATED NetBox table"
  simsql "UPDATE simulated_netbox_vms SET memory = 1024 WHERE serial = 'aws:123456789012/ap-south-1/i-0a1b2c3d4e5f60001';" || code=1
  simsql "UPDATE simulated_netbox_vms SET status = 'offline' WHERE serial = 'gcp:cloudvm-demo-project/4417300000000000005';" || code=1
  simsql "DELETE FROM simulated_netbox_vms WHERE serial = 'proxmox:pve-dc1/101';" || code=1
  simsql "INSERT INTO simulated_netbox_vms (name, \"clusterName\", status, serial, tags, \"updatedAt\") VALUES ('legacy-vm-x', 'AWS/ap-south-1a', 'active', 'aws:123456789012/ap-south-1/i-deadbeef00000000', '{}', now());" || code=1
  simsql "INSERT INTO simulated_netbox_vms (name, \"clusterName\", status, serial, tags, \"updatedAt\") VALUES ('oracle-db-01-copy', 'VMWARE/Prod-Cluster-01', 'active', 'vmware:vcsa01.corp.example.com/50000004-1a2b-4c3d-8e9f-0a1b2c3d4e5f', '{}', now());" || code=1
  echo "  memory web-01 4096->1024 | analytics-db-01 active->offline | gitlab-01 record deleted | orphan legacy-vm-x | duplicate oracle-db-01-copy"

  echo "--- Drift report #2 (expect 5: one of each type)"
  drift_report
  local r2; r2=$(echo "$DRIFT_JSON" | json 'j.id')
  echo "$DRIFT_JSON" | json 'const t=j.summary.byType; j.totalItems===5 && t.MISSING_IN_NETBOX===1 && t.ORPHAN_IN_NETBOX===1 && t.RESOURCE_MISMATCH===1 && t.POWER_STATE_MISMATCH===1 && t.DUPLICATE===1' | grep -qx true \
    && echo "=> drift detection OK (5 findings, all 5 types)" || { echo "=> drift detection FAILED"; code=1; }

  echo "--- Remediate report #2 + sync (fixes MISSING / RESOURCE / POWER)"
  curl -s -X POST "$API/drift/reports/$r2/remediate"; echo
  sync_once || code=1
  echo "--- Operator removes the orphan and the duplicate copy (never automatic)"
  simsql "DELETE FROM simulated_netbox_vms WHERE name IN ('legacy-vm-x', 'oracle-db-01-copy');" || code=1

  echo "--- Drift report #3 (expect 0 findings)"
  drift_report
  echo "$DRIFT_JSON" | json 'j.totalItems===0' | grep -qx true && echo "=> correction OK (0 findings)" || { echo "=> correction FAILED"; code=1; }

  stop_server
  return $code
}
step "Live drift demo (dev DB, SIMULATION)" api_demo

print_summary
