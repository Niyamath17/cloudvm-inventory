# CloudVM – Running Checklist

_Last updated: 30 Oct 2026 (M2 implemented) · Deadline: 31 Oct 2026, 16:00 IST_

Legend: ✅ done & verified · 🟡 done, verification pending · ⏳ pending · ⛔ blocked

## Planning
- ✅ Requirements analysis & architecture proposal (`docs/ARCHITECTURE_PLAN.md`) – **approved**

## M0 – Project scaffold — ✅ COMPLETE (verified on Mac, 30 Oct 2026 15:53 IST)
Source: `bash scripts/verify-m0.sh` → `m0-verification.log` (Darwin arm64, Node 22.23.2, npm 10.9.8)

- ✅ Workspace inspected – no existing files overwritten
- ✅ Backend + frontend structure per approved architecture
- ✅ TypeScript strict mode (backend + frontend)
- ✅ Environment config (Zod-validated) + `.env.example` (root + backend); `backend/.env` uses `localhost:5433`, matches root `.env`
- ✅ Docker: `cloudvm-postgres` (PostgreSQL 16.15, host port 5433) verified healthy from Mac Terminal and VS Code terminal – confirmed by `verify-m0.sh` (container health = healthy)
- ✅ Prisma validate: PASS · Prisma generate (v6.19.3): PASS
- ✅ Prisma migrate status: no migrations – **expected for M0** (no models yet; first migration `init` is created in M1; no empty migration created)
- ✅ Backend typecheck (`tsc --noEmit`): PASS · backend build (`tsc` → `dist/`): PASS
- ✅ Backend tests: **14/14 PASS** (6 env validation, 6 health/error API, 2 real-PostgreSQL connectivity)
- ✅ PostgreSQL connectivity: `npm run db:check` → reachable (PostgreSQL 16.15) in 34 ms; startup log “PostgreSQL connection verified”
- ✅ Frontend production build (`tsc -b && vite build`): PASS
- ✅ Health endpoint: `GET /api/v1/health` → **HTTP 200**, `status: ok`, database `up` (PostgreSQL 16.15), NetBox `mode: SIMULATION`
- ✅ JSON 404: `GET /api/v1/nope` → HTTP 404 `{"error":{"code":"ROUTE_NOT_FOUND",...,"requestId":...}}`
- ✅ Structured JSON logging (Pino) confirmed in server log; graceful SIGTERM shutdown confirmed
- ✅ `scripts/verify-m0.sh` fixed: reliable Docker CLI detection on macOS + container health check; “no migrations” treated as expected – re-run on Mac: **13/13 steps PASS**

### Known, accepted (not blocking)
- `npm audit`: 3 high advisories in the Prisma **CLI**'s dev-time dependency `deepmerge-ts`; fix requires a breaking Prisma 7 upgrade
- The DB test for an unreachable server prints an expected `prisma:error` line to the test output
- Not tested in M0 by the script: `/health` returning 503 while Postgres is stopped against a real server (covered by an automated API test with a fake DB checker)

## M1 – Database schema & MOCK sample data — ✅ COMPLETE (verified on Mac, 30 Oct 2026 18:54 IST)
Source: `bash scripts/verify-m1.sh` → `m1-verification.log` – **13/13 steps PASS**
- ✅ Prisma schema: 9 models, 12 enums (`backend/prisma/schema.prisma`) – validated with Prisma's schema engine (WASM) in Claude's workspace
- ✅ Review fixes: fully scoped `externalId` (+ `nativeId`, required `account`); AWS terminated → DECOMMISSIONED/PROVIDER_TERMINATED; `VmSyncState` per target with FK + CHECK so simulated IDs can't reach live NetBox
- ✅ 2 CHECK constraints (`prisma/sql/init_check_constraints.sql`) – tested against PostgreSQL 16 in Claude's workspace
- ✅ `src/domain/identity.ts` + `src/domain/state.ts` with 16 unit tests
- ✅ Schema decisions documented: `docs/DATABASE.md` (ER diagram + rationale)
- ✅ 5 provider-shaped MOCK sample files, 60 entries (`backend/sample-data/`, each with `_meta.mock: true`)
- ✅ Raw provider Zod schemas (`backend/src/modules/providers/raw/`) – reused by M2 adapters
- ✅ Sample-data tests: 20 tests (labelling, schema, unique IDs, edge cases, no credentials) – pass in Claude's workspace
- ✅ DB constraint tests: 16/16 PASS against real PostgreSQL (`tests/integration/schema.test.ts`)
- ✅ Full backend suite on Mac: **66/66 PASS** (7 files)
- ✅ `scripts/verify-m1.sh` + shared `scripts/lib/verify-common.sh`
- ✅ Migration `20261030132142_init` applied: 9 tables + `_prisma_migrations`, 9 CREATE TABLE, both CHECK constraints present in migration.sql and in PostgreSQL
- ✅ `prisma migrate status`: up to date · `migrate diff` DB vs schema: **No difference detected**
- ✅ Typecheck, build, `/health` regression (HTTP 200, DB up): PASS

## M2 – Provider adapters & normalization — 🟡 IMPLEMENTED, awaiting Mac verification
- ✅ `ProviderAdapter` interface, `NormalizedVm` schema, helpers, deterministic fingerprint, normalization engine, registry
- ✅ 5 MOCK adapters + 5 pure mappers (AWS, Azure, GCP, Proxmox, VMware) – per-record raw validation with the M1 schemas
- ✅ Scope decision: Proxmox templates and LXC containers are **skipped** (LXC = possible future enhancement)
- ✅ Binary units documented and applied consistently: `memoryMb` = MiB, `diskGb` = GiB (`docs/NORMALIZATION.md`)
- ✅ All 60 MOCK entries → **58 VMs, 2 skipped, 0 invalid**; 58 unique identities; 58 distinct fingerprints, identical on re-collection
- ✅ Unit tests in Claude's workspace: **122/122** (80 normalization tests across 9 files) · typecheck clean
- ✅ No database access in `src/domain`, `src/modules/providers`, `src/modules/normalization` (M1 schema unchanged)
- ✅ `scripts/verify-m2.sh`, `backend/scripts/normalize-preview.ts`, `docs/NORMALIZATION.md`
- 🟡 Run `bash scripts/verify-m2.sh` on the Mac

## Environment notes
- Claude's cloud workspace cannot reach `binaries.prisma.sh` / Docker Hub, and Claude's Mac shell is unavailable (low disk space) → all DB/Prisma verification runs on the Mac via `scripts/verify-m0.sh`.

## Pending milestones
- ⏳ M3 Inventory service + collection orchestrator + inventory APIs
- ⏳ M4 NetBox gateway (live + SIMULATION) + sync engine
- ⏳ M5 Drift engine + reports
- ⏳ M6 Scheduler
- ⏳ M7 Frontend shell + Dashboard
- ⏳ M8 Inventory UI
- ⏳ M9 Sync / Drift / Jobs / Settings UI
- ⏳ M10 Docker (full stack) + documentation
- ⏳ M11 End-to-end verification
