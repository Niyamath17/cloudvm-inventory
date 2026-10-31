# CloudVM – Development Notes

A running log of what was built, why, and how to run it. Newest milestone at the top.

---

## M7–M9 – Frontend: shell, Dashboard, Inventory, Synchronization, Drift, Jobs (31 Oct 2026)

**Status:** M7/M8 ✅ visually verified on Mac by Mahesh (Dashboard shows real backend stats; Inventory shows all 58 VMs; MOCK/SIMULATION labels visible). M9 implemented – awaiting Mac visual check.

### Structure
```
frontend/src
├── api/          client.ts (axios, ApiError) · endpoints.ts (one fn per endpoint) · types.ts (DTOs mirroring backend JSON)
├── hooks/        useApi.ts (loading/error/data/reload, stale-response safe) · pollUntil()
├── lib/          format.ts (MiB/GiB formatting, dates, provider colours, drift labels)
├── components/   ui/primitives.tsx (Card, Badge, Stat, Pager, SimulationBanner, Empty/Error states…) · layout/AppLayout.tsx · VmDetailDrawer.tsx
└── pages/        DashboardPage · InventoryPage · SyncPage · DriftPage · JobsPage
```

### Decisions
- **No state library** (Redux/React Query): five screens, each owns its fetches through `useApi`. Less code to explain; easy to swap later.
- **Server-side filtering/sorting/pagination** for Inventory (`GET /vms`), so the UI scales beyond the 58 mock VMs.
- **Long-running actions** (collection, sync) return 202 → UI polls `GET /collections/:id` / `GET /sync/runs/:id` until not RUNNING; if polling gives up it says "still running" instead of guessing.
- **Honesty in the UI:** MOCK badge in the top bar and on provider results; SIMULATION banner on Sync and Drift using the backend's own `label`; sync success messages say "No real NetBox was contacted"; Jobs shows the scheduler as **NOT IMPLEMENTED** (M6 not built).
- **Drift remediation** = two-step (Mark for re-sync → Confirm) → `POST /drift/reports/:id/remediate`, then optional "Run sync & re-check" (POST /sync, poll, POST /drift/reports). Orphans/duplicates are labelled *Manual review*; the UI has **no delete or merge action** (tested).
- Sync events: unchanged VMs are counted as *skipped* but the backend writes no event for them – the UI explains this rather than showing an empty table without context.
- No backend or schema change was needed for M9.

### Verification (Claude's workspace)
- `tsc -b` clean · `vite build` PASS (single 7xx kB bundle; Recharts – chunk-size warning only, acceptable for the prototype)
- `npm test`: **25/25** (format 4, API errors 4, Dashboard 3, Inventory 3, Sync 4, Drift 5, Jobs 2) – API layer mocked, no backend needed

### Mac check
```bash
cd ~/Desktop/CloudVM/frontend
npm test && npm run build
npm run dev   # backend must be running: cd ../backend && npm run dev
```
Walkthrough: Jobs → Run collection → expand run (5 MOCK provider results) · Synchronization → Run sync → counts + events · Drift → Generate report → Mark for re-sync → Confirm → Run sync & re-check.

## M5 – Drift detection & reporting, SIMULATION mode (31 Oct 2026) – ✅ verified on Mac (verify-m5.sh)

Compares the CloudVM inventory with the SIMULATED NetBox records (matching key: `serial`).
Every report is stored with target `SIMULATION`; no real NetBox is contacted or claimed.

| File | Purpose |
|---|---|
| `src/modules/drift/drift.engine.ts` | Pure detection rules + summary |
| `src/modules/drift/drift.service.ts` | Generate (persist report + items), remediate (reset sync state) |
| `src/modules/drift/drift.routes.ts` | Drift API |
| `src/modules/netbox/NetBoxReader.ts` | `listVms()` – implemented by both gateways |
| `tests/unit/drift/*.test.ts` | 14 tests (engine rules, HTTP pagination with stubbed fetch) |
| `tests/integration/drift*.test.ts` | 12 DB/API tests |
| `scripts/verify-m5.sh` | Demo: 0 findings → 5 deliberate differences → remediate + sync + manual cleanup → 0 |

Design choices: drift never changes NetBox itself; correction goes through the verified M4 sync
(by resetting `VmSyncState` to PENDING), and orphan/duplicate records require an operator decision.
Severity rules are documented at the top of `drift.engine.ts`.

---

## M4 – NetBox synchronization, SIMULATION mode (31 Oct 2026) – ✅ verified (257/257)

Design: `docs/SYNC_DESIGN.md`. Every run/state is recorded with target `SIMULATION`; nothing contacts a real NetBox.

| File | Purpose |
|---|---|
| `src/modules/netbox/NetBoxGateway.ts` | Interface + shared error classes (validation, name conflict, auth, transient) |
| `src/modules/netbox/simulated.gateway.ts` | SIMULATION gateway on `simulated_netbox_vms` (P2002 → name conflict) |
| `src/modules/netbox/http.gateway.ts`, `retry.ts` | Real NetBox REST client (not enabled; contract-tested against a fake server) |
| `src/modules/netbox/mapping.ts` | VM → NetBox payload, diff |
| `src/modules/sync/{plan,sync.service,sync.routes}.ts` | Decisions, engine, API |
| `tests/unit/sync/*.test.ts` | 33 tests (mapping, plan, retry, HTTP contract) |
| `tests/integration/{sync,sync-api}.test.ts` | 19 DB tests (simulation) |
| `scripts/verify-m4.sh` | Verification + live demo (collect → sync → sync = 58 skipped) |

Cut for the deadline (approved order): dry run, circuit breaker.
Known limits: IP/interface objects not synced; the simulation table has no `comments` column, so comments are not diffed there.

---

## M3 – Persistence, reconciliation & inventory API (30–31 Oct 2026) – ✅ verified

Mac 31 Oct 08:03 IST: `verify-m3.sh` 10/10 PASS, 205/205 tests (21 files), reconciliation regression 40/40, idempotency (58 unchanged) and locking (202 + 409) confirmed.

### What & why
Stores the normalized MOCK inventory, keeps collection history, safely decommissions VMs that
disappear, and serves the inventory over REST.

### Rules (and where they live)
| Rule | Implementation |
|---|---|
| Failed provider never decommissions | provider exception → ProviderRunResult FAILED, nothing written (`collection.service.ts`) |
| Reconcile only queried, complete accounts | `planReconciliation` – accounts the adapter reports as queried (incl. zero-VM accounts), minus FAILED accounts and accounts tainted by invalid records |
| Idempotent re-run | fingerprint equal → row not rewritten; only `lastDiscoveredAt` advanced in ONE raw `UPDATE` that does not touch `updatedAt` |
| Reactivation | a DECOMMISSIONED VM that reappears → fingerprint differs → UPDATE to ACTIVE, `decommissionedAt`/reason cleared |
| Original decommission time kept | `decommissionedAt` preserved on repeated terminated/missing observations |
| Atomic per provider | `prisma.$transaction` per provider batch |
| One collection at a time | in-process lock (sync claim) + RUNNING-row DB guard; stale RUNNING (>15 min) closed as FAILED |

### Files
`src/modules/collection/{collection.service,reconciliation,collection.routes}.ts`,
`src/modules/inventory/{inventory.writer,inventory.query,inventory.routes}.ts`,
`src/modules/providers/providers.routes.ts`, `src/modules/dashboard/dashboard.routes.ts`,
wiring in `container.ts` / `app.ts` / `index.ts` (modules optional in `createApp`, so M0 health tests are unchanged),
`tests/helpers/test-db.ts`, `tests/integration/{collection,inventory-api}.test.ts`,
`tests/unit/{reconciliation,inventory-query}.test.ts`, `scripts/verify-m3.sh`.
Small compatible change: `fingerprint()` accepts any object with the hashed fields (so a DB row can be re-fingerprinted).

### Known limitations (documented)
- Lock is per process + DB guard; a multi-instance deployment should use a PostgreSQL advisory lock.
- ~~An account whose LAST VM disappears is not reconciled.~~ **Fixed (M3 review):** adapters now
  report every account they queried (`CollectionBatch.accounts`: COMPLETE / FAILED), and
  `planReconciliation` is driven by that list – a COMPLETE account with zero VMs is reconciled,
  a FAILED account never is, an account with invalid records is not. MOCK files declare their
  queried accounts in a top-level `accounts` array (Proxmox: one cluster block per account;
  VMware: the vCenter); `"error"` simulates a failed query.

### Run on the Mac
```bash
cd ~/Desktop/CloudVM && bash scripts/verify-m3.sh
```

---

## M2 – Provider adapters & normalization engine (30 Oct 2026) – ✅ verified (commit 33b975f)

### What & why
Turns five provider-shaped MOCK files into one validated, fingerprinted `NormalizedVm` list –
the input M3 will persist. No database access. Design and per-provider mapping tables:
`docs/NORMALIZATION.md`.

### Files
| File | Purpose |
|---|---|
| `src/domain/normalized-vm.ts` | Common model + Zod schema; binary unit convention (memoryMb = MiB, diskGb = GiB) |
| `src/modules/providers/ProviderAdapter.ts` | Adapter interface, `CollectionBatch` |
| `src/modules/providers/mock/sample-file.ts` | MOCK-label enforcement, per-record validation |
| `src/modules/providers/mock/{aws,azure,gcp,proxmox,vmware}.mock-adapter.ts` | 5 MOCK adapters |
| `src/modules/normalization/mappers/{aws,azure,gcp,proxmox,vmware}.mapper.ts` | 5 pure mappers (+ `common.ts`) |
| `src/modules/normalization/{helpers,fingerprint,types,normalizer}.ts` | Conversions, fingerprint, engine |
| `src/modules/providers/registry.ts` | `defineProvider`, `createMockProviders()` |
| `backend/scripts/normalize-preview.ts` | `npx tsx scripts/normalize-preview.ts` – prints all 58 normalized VMs |
| `tests/unit/normalization/*.test.ts` | 80 tests (per provider, combined, engine, helpers, fingerprint) |
| `scripts/verify-m2.sh` | M2 verification |

### Decisions
- Proxmox templates and LXC containers are skipped; LXC support documented as a future enhancement.
- Memory stays in the M1 `memoryMb` column but holds MiB; no decimal conversion anywhere.
- Hostnames are never invented (e.g. not copied from the GCP instance name) – null + warning.
- Small refactor: AWS mapper now uses the shared `mappers/common.ts` helpers (identity/lifecycle), like the other four.

### Results in Claude's workspace (DB-free)
- Unit tests 122/122; typecheck clean; preview: `TOTAL vms=58 skipped=2 invalid=0`.
- A hand-written expectation in `all-providers.test.ts` (power-state counts) was wrong at first
  (37 RUNNING / 6 UNKNOWN); an independent count of the preview output gave 39 / 13 / 2 / 4, and the
  test was corrected to the verified values.

### Verification results (Mac, 30 Oct 2026 19:29 IST)
`verify-m2.sh` 11/11 PASS: migrate status up to date (schema unchanged); no Prisma imports in
`src/domain`, `src/modules/providers`, `src/modules/normalization`; typecheck + build PASS;
normalization tests 116/116; preview `TOTAL vms=58 skipped=2 invalid=0`; full suite **146/146**
(16 files); `/health` HTTP 200.

### Run on the Mac
```bash
cd ~/Desktop/CloudVM && bash scripts/verify-m2.sh
cd backend && npx tsx scripts/normalize-preview.ts      # optional: see all 58 VMs
```

---

## M1 – Database schema & MOCK sample data (30 Oct 2026) – ✅ verified

### What & why
The database structure every later milestone writes to, plus realistic provider-shaped MOCK data
for the M2 adapters. Design rationale: `docs/DATABASE.md`.

### Files
| File | Purpose |
|---|---|
| `backend/prisma/schema.prisma` | 9 models, 12 enums (replaces the M0 datasource-only schema) |
| `backend/prisma/sql/init_check_constraints.sql` | 2 CHECK constraints appended to the init migration |
| `backend/src/domain/identity.ts` | The only place a scoped `externalId` is built |
| `backend/src/domain/state.ts` | Provider state → lifecycle + power state (AWS terminated ≠ stopped) |
| `backend/tests/unit/identity.test.ts`, `state.test.ts` | 16 tests |
| `backend/sample-data/*.json` | 60 MOCK entries in AWS / Azure / GCP / Proxmox / VMware API shapes |
| `backend/sample-data/README.md` | States clearly that everything in the folder is MOCK |
| `backend/src/modules/providers/raw/*.raw.ts` | Zod schemas for each provider's raw shape (+ `_meta.mock` must be `true`) |
| `backend/tests/unit/sample-data.test.ts` | 20 tests on the sample data |
| `backend/tests/integration/schema.test.ts` | 16 tests proving DB-level constraints (uses `m1test-` rows, cleaned up) |
| `scripts/lib/verify-common.sh`, `scripts/verify-m1.sh` | M1 verification (M0 script left untouched) |
| `docs/DATABASE.md` | ER diagram + schema decisions |

### Steps on the Mac (after approval)
```bash
cd ~/Desktop/CloudVM/backend
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script   # preview SQL, changes nothing
npx prisma migrate dev --name init --create-only                          # write SQL only
cat prisma/sql/init_check_constraints.sql >> prisma/migrations/*_init/migration.sql
npx prisma migrate dev                                                    # apply
cd .. && bash scripts/verify-m1.sh
```
Note: `npm test` now needs the migration – `schema.test.ts` writes to real tables.

### Verification results (Mac, 30 Oct 2026 18:54 IST)
- Migration `20261030132142_init` created with `--create-only`, CHECK SQL appended, applied with `migrate dev`.
- `verify-m1.sh`: 13/13 PASS – migrate status up to date; DB vs schema “No difference detected”; 9 tables + 2 CHECK constraints present; typecheck/build PASS; **66/66 tests**; `/health` 200.
- Prisma reports CHECK violations as PostgreSQL error 23514 with the constraint name in the message (the tests match on the name). The `prisma:error` lines in the test output are the expected rejections, not failures.

---

## M0 – Project scaffold (30 Oct 2026)

### What & why
A runnable skeleton that every later milestone plugs into: strict TypeScript, validated
configuration, structured logs, a database connection, a health endpoint and consistent
error responses. No inventory features yet.

### Versions chosen (and why)
| Package | Version | Reason |
|---|---|---|
| Node.js | ≥ 20 (tested on 22) | LTS, built-in `fetch` for NetBox calls later |
| TypeScript | 5.9.3 | Stable; TS 7 (native compiler) is very new – avoided for a deadline project |
| Express | 5.x | Async errors are forwarded to the error handler automatically |
| Prisma / @prisma/client | **6.19.3 (pinned, identical)** | Mature, classic `prisma-client-js` generator; npm `latest` is an 8.0 release candidate. CLI and client must be the same version |
| Zod | 4.x | Env + request validation |
| Pino / pino-http | 10.x / 11.x | Fast structured JSON logging |
| Vitest | 5.0.5 | Vitest 4.1.12 failed to install with npm 10.9 (`edgesOut` resolver bug) |
| Vite / React / Tailwind | 8 / 19 / 4 | Current stable; Tailwind v4 uses the `@tailwindcss/vite` plugin (no `tailwind.config.js` needed) |

`npm audit` reports 3 "high" advisories, all inside the **Prisma CLI's** dev-time dependency
`deepmerge-ts` (stack exhaustion on recursive objects). It is a development-only tool that
never processes untrusted input here; the only "fix" is a breaking Prisma 7 upgrade. Accepted.

### Key files
| File | Purpose |
|---|---|
| `docker-compose.yml` | PostgreSQL 16 (alpine), bound to `127.0.0.1`, named volume, `pg_isready` healthcheck |
| `.env.example` (root) | Postgres credentials for docker-compose |
| `backend/.env.example` | Backend config: `DATABASE_URL`, `NETBOX_MODE=simulation`, logging, scheduler |
| `backend/src/config/env.ts` | Zod schema – app refuses to start with invalid config; `live` NetBox mode requires URL + token |
| `backend/src/lib/logger.ts` | Pino logger; pretty in dev, JSON otherwise; redacts tokens/passwords |
| `backend/src/lib/prisma.ts` | Single PrismaClient factory (one connection pool per process) |
| `backend/src/lib/database.ts` | `SELECT version()` check with timeout; returns `{status, latencyMs, serverVersion, error}`, never throws |
| `backend/src/lib/errors.ts` | `AppError` + `NotFoundError`, `ValidationError`, `ConflictError`, `ServiceUnavailableError` |
| `backend/src/middleware/requestLogger.ts` | pino-http, request IDs (`x-request-id`), health checks logged at debug |
| `backend/src/middleware/errorHandler.ts` | One JSON error shape: `{ error: { code, message, details?, requestId } }` |
| `backend/src/modules/health/health.routes.ts` | `GET /api/v1/health` |
| `backend/src/app.ts` | Builds the Express app from injected deps (testable, no `listen`) |
| `backend/src/container.ts` | Composition root – the only place concrete implementations are created |
| `backend/src/index.ts` | Startup DB check, listen, graceful shutdown |
| `backend/scripts/check-db.ts` | `npm run db:check` |
| `frontend/vite.config.ts` | Tailwind plugin + `/api` → `http://localhost:4000` proxy |
| `frontend/src/App.tsx` | Placeholder page showing backend / DB / NetBox-mode status |

### Design notes
- **Two `.env` files.** Docker Compose reads the root `.env`; the backend reads `backend/.env`.
  The Postgres user/password/db must match in both.
- **Startup does not crash when Postgres is down.** It logs an error and `/health` returns
  `503 degraded`; once Postgres is back, health turns `200 ok` without a restart.
- **NetBox in M0** is configuration only. Health reports `mode: SIMULATION` with an explicit
  label and no `reachable` flag, so it can never be mistaken for a real NetBox connection.

### Verification results (Mac, 30 Oct 2026 15:53 IST)
Run with `bash scripts/verify-m0.sh` (output in `m0-verification.log`, git-ignored).
Environment: macOS Darwin arm64 (Apple Silicon), Node 22.23.2, npm 10.9.8, Docker Desktop.

| Check | Result |
|---|---|
| Docker / `cloudvm-postgres` | Healthy – PostgreSQL 16.15, host port **5433** → container 5432 (verified in Mac Terminal and VS Code terminal) |
| Config consistency | `backend/.env` `DATABASE_URL` matches root `.env` (user, password, port 5433, database) |
| `prisma validate` / `prisma generate` | PASS / PASS (client v6.19.3) |
| `prisma migrate status` | “No migration found” – **expected in M0** (no models yet). No empty migration was created; `init` comes in M1 |
| Backend `typecheck` / `build` | PASS / PASS |
| Backend tests | **14/14 PASS** (6 env, 6 health/error API, 2 real PostgreSQL) |
| `npm run db:check` | PostgreSQL 16.15 reachable in 34 ms |
| Frontend production build | PASS |
| `GET /api/v1/health` | **HTTP 200**, `status: ok`, database `up`, NetBox `mode: SIMULATION` |
| `GET /api/v1/nope` | HTTP 404, JSON `ROUTE_NOT_FOUND` with `requestId` |

Issues found and fixed during verification:
- `backend/.env` did not exist → created from `.env.example` with port 5433 (the host port chosen in the root `.env`).
- `verify-m0.sh` reported `docker: command not found` although Docker works in the terminals: the
  script's non-login shell did not have Docker Desktop's CLI on its `PATH`. The script now looks
  for the CLI on `PATH` and in Docker Desktop's install locations (`~/.docker/bin`,
  `/usr/local/bin`, `/opt/homebrew/bin`, `Docker.app/Contents/Resources/bin`), checks the engine
  is running, and requires `cloudvm-postgres` health = `healthy`.
- `prisma migrate status` exits 1 when no migrations exist. The script now treats exactly that
  case as expected for M0, and still fails if the database is unreachable (P1001) or migrations
  are pending.

### How to run (on the Mac)
```bash
cd ~/Desktop/CloudVM

# 1. Environment files (first time only)
cp .env.example .env                        # set POSTGRES_PORT=5433 if 5432 is taken
sed 's/localhost:5432/localhost:5433/' backend/.env.example > backend/.env

# 2. Start PostgreSQL and wait for "healthy"
docker compose up -d postgres
docker compose ps

# 3. Backend
cd backend
npm install            # also runs `prisma generate`
npm run db:check       # ✔ PostgreSQL reachable (PostgreSQL 16.x) in N ms
npm test               # all tests incl. real DB connectivity
npm run build          # compiles to dist/
npm run dev            # http://localhost:4000/api/v1

# 4. Frontend (new terminal)
cd ~/Desktop/CloudVM/frontend
npm install
npm run dev            # http://localhost:5173

# Or run every M0 check at once:
cd ~/Desktop/CloudVM && bash scripts/verify-m0.sh
```

### Verify the health endpoint
```bash
curl -s http://localhost:4000/api/v1/health | python3 -m json.tool
# expect HTTP 200, "status": "ok", checks.database.status = "up", checks.netbox.mode = "SIMULATION"

docker compose stop postgres
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4000/api/v1/health   # expect 503
docker compose start postgres
```
