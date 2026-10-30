# CloudVM – Running Checklist

_Last updated: 30 Oct 2026 (M0 verified) · Deadline: 31 Oct 2026, 16:00 IST_

Legend: ✅ done & verified · 🟡 done, verification pending · ⏳ pending · ⛔ blocked

## Planning
- ✅ Requirements analysis & architecture proposal (`docs/ARCHITECTURE_PLAN.md`) – **approved**

## M0 – Project scaffold — ✅ COMPLETE (verified on Mac, 30 Oct 2026 15:53 IST)
Source: `bash scripts/verify-m0.sh` → `m0-verification.log` (Darwin arm64, Node 22.23.2, npm 10.9.8)

- ✅ Workspace inspected – no existing files overwritten
- ✅ Backend + frontend structure per approved architecture
- ✅ TypeScript strict mode (backend + frontend)
- ✅ Environment config (Zod-validated) + `.env.example` (root + backend); `backend/.env` uses `localhost:5433`, matches root `.env`
- ✅ Docker: `cloudvm-postgres` (PostgreSQL 16.15, host port 5433) verified healthy from Mac Terminal and VS Code terminal (verified by Mahesh; the first script run could not find the `docker` CLI – fixed, see below)
- ✅ Prisma validate: PASS · Prisma generate (v6.19.3): PASS
- ✅ Prisma migrate status: no migrations – **expected for M0** (no models yet; first migration `init` is created in M1; no empty migration created)
- ✅ Backend typecheck (`tsc --noEmit`): PASS · backend build (`tsc` → `dist/`): PASS
- ✅ Backend tests: **14/14 PASS** (6 env validation, 6 health/error API, 2 real-PostgreSQL connectivity)
- ✅ PostgreSQL connectivity: `npm run db:check` → reachable (PostgreSQL 16.15) in 34 ms; startup log “PostgreSQL connection verified”
- ✅ Frontend production build (`tsc -b && vite build`): PASS
- ✅ Health endpoint: `GET /api/v1/health` → **HTTP 200**, `status: ok`, database `up` (PostgreSQL 16.15), NetBox `mode: SIMULATION`
- ✅ JSON 404: `GET /api/v1/nope` → HTTP 404 `{"error":{"code":"ROUTE_NOT_FOUND",...,"requestId":...}}`
- ✅ Structured JSON logging (Pino) confirmed in server log; graceful SIGTERM shutdown confirmed
- ✅ `scripts/verify-m0.sh` fixed: reliable Docker CLI detection on macOS + container health check; “no migrations” treated as expected – **fixed script not yet re-run on the Mac**

### Known, accepted (not blocking)
- `npm audit`: 3 high advisories in the Prisma **CLI**'s dev-time dependency `deepmerge-ts`; fix requires a breaking Prisma 7 upgrade
- The DB test for an unreachable server prints an expected `prisma:error` line to the test output
- Not tested in M0 by the script: `/health` returning 503 while Postgres is stopped against a real server (covered by an automated API test with a fake DB checker)

## Environment notes
- Claude's cloud workspace cannot reach `binaries.prisma.sh` / Docker Hub, and Claude's Mac shell is unavailable (low disk space) → all DB/Prisma verification runs on the Mac via `scripts/verify-m0.sh`.

## Pending milestones
- ⏳ M1 Prisma schema + migration + provider-shaped MOCK sample data
- ⏳ M2 Adapter interface + 5 MOCK adapters + normalization engine
- ⏳ M3 Inventory service + collection orchestrator + inventory APIs
- ⏳ M4 NetBox gateway (live + SIMULATION) + sync engine
- ⏳ M5 Drift engine + reports
- ⏳ M6 Scheduler
- ⏳ M7 Frontend shell + Dashboard
- ⏳ M8 Inventory UI
- ⏳ M9 Sync / Drift / Jobs / Settings UI
- ⏳ M10 Docker (full stack) + documentation
- ⏳ M11 End-to-end verification
