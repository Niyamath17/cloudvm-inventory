#!/usr/bin/env bash
# CloudVM – M2 verification (provider adapters + normalization engine)
#
# M2 reads MOCK sample files only and writes NOTHING to PostgreSQL. The database
# is still needed for the full test suite (M1 constraint tests) and the /health check.
#
# Usage (from the project root):   bash scripts/verify-m2.sh

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/m2-verification.log"
: > "$LOG"
# shellcheck source=lib/verify-common.sh
source "$ROOT/scripts/lib/verify-common.sh"

{
  echo "CloudVM M2 verification – $(date)"
  echo "OS: $(uname -sm)   node: $(node -v 2>/dev/null)   npm: $(npm -v 2>/dev/null)   docker: ${DOCKER:-NOT FOUND}"
} | tee -a "$LOG"

step "Config consistency"                         check_config
step "Postgres container healthy"                 check_postgres_container

cd "$ROOT/backend"
step "Backend npm install (+prisma generate)"     npm install --no-audit --no-fund
step "Prisma migrate status (M1 schema unchanged)" npx prisma migrate status

# The normalization pipeline must stay free of database access (persistence is M3).
check_no_db_access() {
  local hits
  hits=$(grep -rlE "@prisma/client|lib/prisma|PrismaClient" src/domain src/modules/providers src/modules/normalization 2>/dev/null)
  if [ -n "$hits" ]; then echo "Database access found in M2 modules:"; echo "$hits"; return 1; fi
  echo "OK: src/domain, src/modules/providers, src/modules/normalization do not import Prisma"
}
step "No DB access in adapters/normalizer"        check_no_db_access

step "Backend typecheck (tsc --noEmit)"           npm run typecheck
step "Backend build (tsc -> dist)"                npm run build
step "Normalization unit tests"                   npx vitest run tests/unit/normalization tests/unit/identity.test.ts tests/unit/state.test.ts tests/unit/sample-data.test.ts

# Runs all five MOCK adapters and asserts the expected totals.
check_preview() {
  local out
  out=$(npx tsx scripts/normalize-preview.ts 2>&1)
  echo "$out"
  echo "$out" | grep -q "TOTAL vms=58 skipped=2 invalid=0" || { echo "=> expected TOTAL vms=58 skipped=2 invalid=0"; return 1; }
}
step "All 60 MOCK records -> 58 VMs / 2 skipped / 0 invalid" check_preview
step "Full backend test suite (unit + DB)"         npm test
step "Health endpoint still OK (regression)"       health_check

print_summary
