# CloudVM – Running Checklist

_Last updated: 31 Oct 2026 13:10 IST (M9 frontend implemented) · Deadline: 31 Oct 2026, 16:00 IST_

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

## M2 – Provider adapters & normalization — ✅ COMPLETE (verified on Mac, 30 Oct 2026 19:29 IST, commit 33b975f)
Source: `bash scripts/verify-m2.sh` → `m2-verification.log` – **11/11 steps PASS**
- ✅ `ProviderAdapter` interface, `NormalizedVm` schema, helpers, deterministic fingerprint, normalization engine, registry
- ✅ 5 MOCK adapters + 5 pure mappers (AWS, Azure, GCP, Proxmox, VMware) – per-record raw validation with the M1 schemas
- ✅ Scope decision: Proxmox templates and LXC containers are **skipped** (LXC = possible future enhancement)
- ✅ Binary units documented and applied consistently: `memoryMb` = MiB, `diskGb` = GiB (`docs/NORMALIZATION.md`)
- ✅ All 60 MOCK entries → **58 VMs, 2 skipped, 0 invalid**; 58 unique identities; 58 distinct fingerprints, identical on re-collection
- ✅ Unit tests in Claude's workspace: **122/122** (80 normalization tests across 9 files) · typecheck clean
- ✅ No database access in `src/domain`, `src/modules/providers`, `src/modules/normalization` (M1 schema unchanged)
- ✅ `scripts/verify-m2.sh`, `backend/scripts/normalize-preview.ts`, `docs/NORMALIZATION.md`
- ✅ Mac: normalization tests 116/116 · full backend suite **146/146** (16 files, incl. 24 DB tests) · preview `TOTAL vms=58 skipped=2 invalid=0`
- ✅ Mac: `prisma migrate status` up to date (M1 schema unchanged) · no Prisma imports in M2 modules · typecheck/build PASS · `/health` 200

## M3 – Persistence, reconciliation & inventory API — ✅ COMPLETE (verified on Mac, 31 Oct 2026 08:03 IST)
Source: `bash scripts/verify-m3.sh` → `m3-verification.log` – **10/10 steps PASS**, **205/205 tests** (21 files), reconciliation regression 40/40
- ✅ `CollectionService`: in-process lock + DB guard (RUNNING run blocks; stale >15 min closed as FAILED); background run with 202
- ✅ `planReconciliation`: driven by the accounts each adapter reports it QUERIED – COMPLETE accounts (incl. zero-VM) reconciled; FAILED accounts and accounts with invalid records never; FAILED provider never
- ✅ Review fix: zero-VM account reconciliation (adapters report `accounts` with COMPLETE/FAILED; MOCK `accounts` array / Proxmox cluster `error` / VMware `error`)
- ✅ `writeProviderBatch`: one transaction per provider – create / update (incl. reactivation) / unchanged (heartbeat only, one SQL statement, `updatedAt` untouched) / account-scoped decommission (`MISSING_FROM_PROVIDER`, power UNKNOWN, fingerprint recomputed)
- ✅ API: `POST/GET /collections`, `GET /collections/:id`, `GET /vms` (search, filters, sort, pagination), `GET /vms/facets`, `GET /vms/:id`, `GET /providers`, `GET /dashboard/summary`
- ✅ Separate test database `cloudvm_test` (integration tests truncate it; dev DB never truncated); `fileParallelism: false`
- ✅ Mac run before the fix: 9/9 PASS, 183/183 tests, idempotency + locking OK
- ✅ Claude's workspace after the fix (no DB): typecheck clean · 150 tests pass, 55 DB tests skipped
- ✅ New tests: reconciliation 10, accounts 5, query 6 (unit); collection 25 (incl. 12 account-level regression), API 12 (DB)
- ✅ Mac: idempotency OK (58 unchanged), locking OK (one 202, one 409), live API demo PASS, dev DB schema unchanged

## M4 – NetBox synchronization (SIMULATION) — ✅ COMPLETE (verified on Mac, 31 Oct 2026: 257/257 tests, live collection + SIMULATION sync demo; committed and tagged by Mahesh)
- ✅ `NetBoxGateway` interface; `SimulatedNetBoxGateway` (simulated_netbox_vms, NetBox rules); `HttpNetBoxGateway` (real REST client, Token/Bearer, retries) – **contract-tested against a local fake server only, not run against real NetBox, live mode not enabled**
- ✅ Mapping (built-in fields only: serial, cluster, vcpus, memory MiB, disk MB, status, tags, comments) + changed-field diff
- ✅ `SyncService`: skip-unchanged with zero gateway calls, match (stored id → serial → name w/o serial), CREATE / UPDATE / DECOMMISSION / DUPLICATE, name disambiguation, auth abort, per-VM failure, lock
- ✅ API: `POST /sync`, `GET /sync/runs`, `GET /sync/runs/:id`, `GET /netbox/status`, `GET /netbox/simulated-vms`; dashboard `lastSync` (flagged `simulated`)
- ✂️ Cut for the deadline (approved): dry run, circuit breaker
- ✅ No DB schema change · Claude's workspace: typecheck clean, 183 tests pass (33 new sync unit/contract tests), 74 DB tests skipped (19 new)

## M5 – Drift detection & reporting (SIMULATION) — ✅ COMPLETE (verified on Mac via `verify-m5.sh`; commit 4250a7a, tag m5-verified)
- ✅ Pure drift engine: MISSING_IN_NETBOX, ORPHAN_IN_NETBOX (managed WARNING / unmanaged INFO), DUPLICATE (CRITICAL), POWER_STATE_MISMATCH (WARNING / CRITICAL on lifecycle disagreement), RESOURCE_MISMATCH (vcpus/memory/disk WARNING, name/cluster INFO)
- ✅ Not compared (no false drift): UNKNOWN power, null local resources, disambiguated names, never-synced decommissioned VMs
- ✅ Reports + items persisted in the M1 `drift_reports` / `drift_items` tables – **no schema change**
- ✅ Remediation: `POST /drift/reports/:id/remediate` resets sync state for MISSING/RESOURCE/POWER drift → next `POST /sync` corrects it; orphans/duplicates are never deleted automatically
- ✅ API: `POST/GET /drift/reports`, `GET /drift/reports/latest`, `GET /drift/reports/:id?type=&severity=`, `POST /drift/reports/:id/remediate` – every response labelled SIMULATION
- ✅ Read-only `NetBoxReader.listVms()` on both gateways (M4 `NetBoxGateway` interface unchanged)
- ✅ Claude's workspace: typecheck clean · 197 tests pass (14 new unit) · 86 DB tests skipped (12 new)
- ✅ Mac: `verify-m5.sh` PASS (demo: 0 → 5 findings → 0 after remediation + sync)

## M7/M8 – Frontend shell, Dashboard, Inventory — ✅ COMPLETE (visually verified on Mac by Mahesh: real stats, 58 VMs, MOCK/SIMULATION labels)
- ✅ React Router layout: sidebar (Dashboard, Inventory, Synchronization, Drift, Jobs), mobile drawer, top bar with `MOCK PROVIDER DATA` + `NETBOX SIMULATION` badges from `GET /netbox/status` (`API OFFLINE` on error)
- ✅ API layer: axios client (`/api/v1` via Vite proxy), `ApiError` mapping of `{error:{code,message}}`, one function per endpoint, `useApi` hook (stale-response safe)
- ✅ Dashboard: KPIs, VMs-by-provider chart, capacity table, latest collection / sync (SIMULATION) / drift cards, Run collection (POST + poll), empty/error/loading states – all values from `/dashboard/summary` + `/drift/reports/latest`
- ✅ Inventory: debounced search (name/hostname/IP), provider + power chips with facet counts, lifecycle filter, server-side sorting & pagination, VM detail drawer (`/vms/:id`, sync state, raw MOCK payload)
- ✅ Claude's workspace: `tsc -b` clean · `vite build` PASS (bundle 708 kB, chunk-size warning only) · **14/14 frontend tests** (format 4, API errors 4, Dashboard 3, Inventory 3) with mocked API
- ✅ Mac: running in the browser against the real backend

## M9 – Synchronization, Drift, Jobs UI — 🟡 IMPLEMENTED, awaiting Mac verification
- ✅ Synchronization: SIMULATION banner (backend label + simulated record count), Run sync (POST + poll, 409 message), created/updated/decommissioned/skipped/failed/duplicate tiles, paginated history, per-run events with diff (from → to), errors and a Problems filter
- ✅ Drift: latest report, severity tiles, type cards (click to filter), severity filter, findings grouped by type with collected vs NetBox values, VM drawer link, remediation with confirm step → `POST /drift/reports/:id/remediate` → "Run sync & re-check"; orphans/duplicates = *Manual review*, **no delete/merge action**
- ✅ Jobs: scheduler card **NOT IMPLEMENTED** (M6), collection history with expandable provider-level results (MOCK badge, VM/invalid counts, duration, errors), sync history
- ✅ Loading, empty, error and success states on every screen; no backend/schema change
- ✅ Claude's workspace: `tsc -b` clean · `vite build` PASS · **25/25 frontend tests** (11 new)
- 🟡 Mac: `npm test && npm run build`, visual walkthrough

## Environment notes
- Claude's cloud workspace cannot reach `binaries.prisma.sh` / Docker Hub, and Claude's Mac shell is unavailable (low disk space) → all DB/Prisma verification runs on the Mac via `scripts/verify-m0.sh`.

## Pending milestones
- ⏳ M6 Scheduler
- ✅ M7 Frontend shell + Dashboard
- ✅ M8 Inventory UI
- 🟡 M9 Sync / Drift / Jobs UI – implemented, awaiting Mac check
- ⏳ M10 Docker (full stack) + documentation
- ⏳ M11 End-to-end verification
