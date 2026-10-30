#!/usr/bin/env bash
# CloudVM – M1 verification (database schema + MOCK sample data)
#
# Run AFTER the init migration (including prisma/sql/init_check_constraints.sql) is applied:
#   cd backend
#   npx prisma migrate dev --name init --create-only
#   cat prisma/sql/init_check_constraints.sql >> prisma/migrations/*_init/migration.sql
#   npx prisma migrate dev
# Writes everything to m1-verification.log (git-ignored). Never prints secrets.
#
# Usage (from the project root):   bash scripts/verify-m1.sh

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/m1-verification.log"
: > "$LOG"
# shellcheck source=lib/verify-common.sh
source "$ROOT/scripts/lib/verify-common.sh"

{
  echo "CloudVM M1 verification – $(date)"
  echo "OS: $(uname -sm)   node: $(node -v 2>/dev/null)   npm: $(npm -v 2>/dev/null)   docker: ${DOCKER:-NOT FOUND}"
} | tee -a "$LOG"

EXPECTED_TABLES="virtual_machines vm_sync_states collection_runs provider_run_results sync_runs sync_events drift_reports drift_items simulated_netbox_vms _prisma_migrations"

step "Config consistency"                       check_config
step "Postgres container healthy"               check_postgres_container

cd "$ROOT/backend"
step "Backend npm install (+prisma generate)"   npm install --no-audit --no-fund
step "Prisma validate schema"                   npx prisma validate
step "Prisma generate client"                   npx prisma generate

check_init_migration() {
  local dir
  dir=$(ls -d prisma/migrations/*_init 2>/dev/null | head -1)
  [ -n "$dir" ] || { echo "No *_init migration found – see the commands at the top of this script"; return 1; }
  echo "Found $dir"
  grep -c 'CREATE TABLE' "$dir/migration.sql" | sed 's/^/CREATE TABLE statements: /'
  local missing=0
  for c in vm_sync_states_target_id_check virtual_machines_lifecycle_check; do
    grep -q "$c" "$dir/migration.sql" && echo "migration.sql contains CHECK $c" || { echo "MISSING in migration.sql: CHECK $c"; missing=1; }
  done
  [ "$missing" -eq 0 ] || return 1
  ls prisma/migrations
}
step "Init migration exists"                    check_init_migration
step "Prisma migrate status (up to date)"       npx prisma migrate status

# Compares the LIVE database with schema.prisma. --exit-code: 0 = identical, 2 = differences.
check_no_drift() {
  npx prisma migrate diff --from-url "$(env_value "$ROOT/backend/.env" DATABASE_URL)" \
    --to-schema-datamodel prisma/schema.prisma --exit-code
}
step "Database matches schema.prisma (no drift)" check_no_drift

check_tables() {
  local user db tables missing=0
  user=$(env_value "$ROOT/.env" POSTGRES_USER); db=$(env_value "$ROOT/.env" POSTGRES_DB)
  tables=$("$DOCKER" exec cloudvm-postgres psql -U "$user" -d "$db" -Atc \
    "select tablename from pg_tables where schemaname='public' order by 1")
  echo "$tables"
  for t in $EXPECTED_TABLES; do
    echo "$tables" | grep -qx "$t" || { echo "MISSING TABLE: $t"; missing=1; }
  done
  echo "--- CHECK constraints:"
  local checks
  checks=$("$DOCKER" exec cloudvm-postgres psql -U "$user" -d "$db" -Atc \
    "select conname from pg_constraint where contype='c' and connamespace='public'::regnamespace order by 1")
  echo "$checks"
  for c in vm_sync_states_target_id_check virtual_machines_lifecycle_check; do
    echo "$checks" | grep -qx "$c" || { echo "MISSING CHECK CONSTRAINT: $c"; missing=1; }
  done
  echo "--- unique constraints / indexes on virtual_machines:"
  "$DOCKER" exec cloudvm-postgres psql -U "$user" -d "$db" -Atc \
    "select indexname from pg_indexes where tablename='virtual_machines' order by 1"
  return $missing
}
step "All 9 tables + 2 CHECK constraints exist"         check_tables

step "Backend typecheck (tsc --noEmit)"         npm run typecheck
step "Backend build (tsc -> dist)"              npm run build
step "Backend tests (unit + DB constraints)"    npm test
step "Health endpoint still OK (regression)"    health_check

print_summary
