# CloudVM – Development Notes

A running log of what was built, why, and how to run it. Newest milestone at the top.

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
