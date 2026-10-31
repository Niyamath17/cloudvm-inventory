# CloudVM – Interview Notes

Talking points, design rationale and defensible answers. Everything here describes code that exists in the repository; simulated and unimplemented parts are called out explicitly.

**One-sentence summary:** a modular-monolith TypeScript application that collects VM inventory from five providers through a common adapter interface (MOCK data in this prototype), normalizes it into one validated model, persists it idempotently in PostgreSQL, synchronizes it to NetBox (SIMULATION mode) and reports drift – with a React dashboard on top.

**What is real vs simulated**
| Real, implemented and tested | Simulated / not built |
|---|---|
| Adapter interface, five mappers, normalization, validation | Provider data = MOCK sample files |
| Persistence, reconciliation, decommissioning, idempotency | NetBox target = SIMULATION table |
| Locking, error handling, sync decision logic, drift engine | Live NetBox gateway tested only against a fake server |
| REST API (Zod validated), React UI | Scheduler (M6) not implemented |
| 283 backend tests (M5), 25 frontend tests | No auth, no app Docker images |

---

## 1. Architecture and design decisions

**Modular monolith, not microservices.** One Express process, one PostgreSQL database, modules with clear boundaries (`providers`, `normalization`, `collection`, `inventory`, `netbox`, `sync`, `drift`, `dashboard`). Reasons: one deployable, transactions across modules, simple local setup, and a timeline of days. The boundaries are interfaces, so a module could be extracted later (e.g. collectors as workers) without rewriting logic.

**Dependency injection through a composition root.** `src/container.ts` is the only place that creates concrete classes: Prisma client, adapters, `SimulatedNetBoxGateway` *or* `HttpNetBoxGateway` (chosen from `NETBOX_MODE`), and the services. Services receive dependencies in their constructors. Effect: tests pass fakes (e.g. a database checker that reports "down"), and switching simulation ↔ live is one line.

**`createApp(deps)` does not listen.** The Express app is built from injected dependencies and returned; `index.ts` calls `listen`. Supertest mounts the real app in tests.

**Layering inside a feature:** routes (HTTP + Zod) → service (orchestration, transactions, locks) → pure functions (mappers, reconciliation plan, sync decisions, drift engine). The pure functions hold most of the business rules and are unit-tested without a database.

**Validation at every boundary:** environment (Zod, process refuses to start), raw provider records (per-provider Zod schemas), `NormalizedVm` (Zod), API query/path params (Zod → 400 with details).

**Error handling:** typed `AppError` subclasses (`NotFoundError` 404, `ConflictError` 409, `ValidationError` 400) are mapped by one central middleware to `{ error: { code, message, details?, requestId } }`. Unknown errors → 500 with a generic message; the stack is logged (Pino, JSON, with request ID), never returned.

## 2. Adapter pattern and normalization

- `ProviderAdapter<TRaw>` returns a `CollectionBatch`: `records`, `rejected` (raw records that failed validation, with reason), and `accounts` – every account/subscription/project/cluster/vCenter it queried, each `COMPLETE` or `FAILED`.
- Each provider has a **pure mapper** `raw → NormalizedVm`. The MOCK adapter only replaces *where raw data comes from* (a JSON file instead of the SDK). A real adapter swaps the fetch and keeps the mapper and its tests.
- **Scoped identity** (`externalId`): AWS `account/region/instanceId`, Azure `subscription/vmId`, GCP `project/id`, Proxmox `cluster/vmid`, VMware `vcenter/instanceUuid`. Native IDs are not globally unique (Proxmox VMIDs restart per cluster; the same AWS ID format exists in every account). DB constraint: `UNIQUE(provider, externalId)`.
- **Units:** `memoryMb` = MiB, `diskGb` = GiB, converted once in each provider's mapper from whatever unit that provider reports. Documented in `docs/NORMALIZATION.md`.
- **Lifecycle vs power state:** `powerState` (RUNNING/STOPPED/SUSPENDED/UNKNOWN) is separate from `lifecycle` (ACTIVE/DECOMMISSIONED). AWS `terminated` → DECOMMISSIONED with reason `PROVIDER_TERMINATED`; a VM that disappears from a completely queried account → DECOMMISSIONED with `MISSING_FROM_PROVIDER`.
- **Missing / inconsistent data:** nullable fields stay `null` (never invented); invalid records are rejected **individually** and counted (`invalidCount`), the rest of the batch continues. Proxmox templates and LXC containers are skipped by design (not VMs).
- Result on the sample data: 60 entries → 58 VMs, 2 skipped, 0 invalid.

## 3. Prisma data model (9 models)

| Model | Purpose |
|---|---|
| `VirtualMachine` | Normalized VM, `rawData` (original payload), `fingerprint`, lifecycle fields, discovery timestamps. `UNIQUE(provider, externalId)` |
| `CollectionRun` / `ProviderRunResult` | Collection history; one result per provider per run (`UNIQUE(runId, provider)`) |
| `SyncRun` / `SyncEvent` | Sync history and per-VM actions (with `diff` and a `vmName` snapshot) |
| `VmSyncState` | Per VM **per target** (`UNIQUE(vmId, target)`): state, `netboxId` or `simulatedVmId`, `syncedFingerprint` |
| `DriftReport` / `DriftItem` | Drift history with type, severity, expected vs actual |
| `SimulatedNetboxVm` | The SIMULATION target; mirrors NetBox's `UNIQUE(cluster, name)` and non-unique `serial` |

Safety detail: a SIMULATION sync state can only reference a simulated record (FK) and a NETBOX state only a real NetBox ID – enforced by two **CHECK constraints** added in the init migration, so a simulated ID can never be sent to a live NetBox.

## 4. Fingerprinting and idempotency

- **Fingerprint** = SHA-256 of a canonical JSON of the sync-relevant fields (fixed key order, sorted IPs, sorted tag keys, version number). Excluded on purpose: discovery timestamps, raw payload, raw power string, data source – they change without the VM changing.
- **Collection idempotency:** for each normalized VM: new → CREATE; fingerprint changed → UPDATE (including re-activation of a decommissioned VM); unchanged → one SQL statement that only bumps `lastDiscoveredAt` (`updatedAt` untouched). Verified: second collection = 58 unchanged.
- **Sync idempotency:** `VmSyncState.syncedFingerprint` stores the fingerprint at last successful sync. Equal → SKIP with **zero gateway calls**. Verified: second sync = 0 created / 0 updated / 58 skipped.
- **Changed-fields-only updates:** the sync computes a diff against the remote record and PATCHes only differing fields; the diff is stored on the event.

## 5. Reconciliation and safe decommissioning

The question "which VMs are gone?" is answered **per account**, not per provider:
- Accounts reported `COMPLETE` (including ones that returned **zero VMs**) are reconciled: local ACTIVE VMs of that account not seen this run → DECOMMISSIONED.
- `FAILED` accounts, accounts with any rejected record, and failed providers are **never** reconciled – a timeout must not mark half the estate as deleted.
- One transaction per provider, so a failure in one provider cannot leave another half-written.
This was a review finding I fixed explicitly (zero-VM accounts were initially not reconciled) with regression tests for each scenario.

## 6. Sync locking and error handling

- **Locking:** an in-process lock plus a database guard: a `RUNNING` row blocks a new run (409). A `RUNNING` row older than 15 minutes is considered abandoned (process crashed) and closed as `FAILED`. Verified: two concurrent `POST /collections` → one 202, one 409. Same pattern for sync.
- **Background runs:** POST returns 202 + run ID immediately; the UI polls the run endpoint.
- **Matching** a VM to a NetBox record: stored remote ID → `serial` (`<provider>:<externalId>`) → name within cluster without a serial. More than one record with the same serial → **DUPLICATE**: reported, not written.
- **Decisions:** CREATE / UPDATE / DECOMMISSION (NetBox status `decommissioning`) / SKIP. A decommissioned VM that was never synced is skipped – dead VMs are not created. UNKNOWN power is not sent (no false "offline").
- **NetBox fields used** are built-in only: name, cluster, status, serial, vcpus, memory, disk, tags, comments – no custom fields assumed.
- **Errors:** per-VM failures are recorded on the event and counted; the run continues → `PARTIAL`. Authentication errors (401/403) abort the run (every further call would fail). The HTTP gateway retries 429 and 5xx with backoff and classifies name-conflict and validation errors.

## 7. Drift detection

`NetBoxReader.listVms()` (read-only, on both gateways) + local inventory → a **pure drift engine**:

| Type | Severity | Meaning |
|---|---|---|
| `MISSING_IN_NETBOX` | WARNING | Synced/active VM with no remote record |
| `ORPHAN_IN_NETBOX` | WARNING if CloudVM-managed, INFO otherwise | Remote record with no local VM |
| `DUPLICATE` | CRITICAL | Several remote records for one VM |
| `POWER_STATE_MISMATCH` | WARNING (CRITICAL if lifecycle disagrees) | Status differs |
| `RESOURCE_MISMATCH` | WARNING for vCPU/memory/disk, INFO for name/cluster | Field differs |

Avoiding false drift: UNKNOWN power, null local values, disambiguated names and never-synced decommissioned VMs are not compared.
**Remediation** resets sync state for missing/resource/power findings; the next sync corrects them. Orphans and duplicates require a human – **nothing is deleted automatically**. Verified demo: 0 → 5 findings (one per type) → 0.

## 8. Frontend

React + TypeScript strict + Tailwind; five screens. A small `useApi` hook (loading/error/data/reload, ignores stale responses) instead of Redux/React Query – fewer moving parts for five screens. Typed API layer mirrors backend DTOs; errors normalized to `ApiError`. Server-side filtering/sorting/pagination. MOCK and SIMULATION labels come from backend fields (`dataSource`, `target`, `label`), not hard-coded strings. Tests with Testing Library cover data rendering, empty/error states, the remediation confirm step and the absence of any delete action.

## 9. Trade-offs and limitations

| Decision | Trade-off |
|---|---|
| Modular monolith | Simple; scaling collectors independently would need extraction later |
| MOCK adapters | No credentials or cost; real API quirks (pagination, throttling) not exercised |
| SIMULATION target | Safe, repeatable demos; real NetBox behaviour not verified |
| Fingerprint skip | Very cheap re-syncs; a manual NetBox edit is not detected by sync alone – that is what drift reports are for |
| In-process + DB-row lock | Correct for one instance; multi-instance needs `pg_advisory_lock` or a job queue |
| Polling for run status | Simple; SSE/WebSocket would be nicer |
| No auth | Acceptable for a local prototype only |
| Cut for deadline (approved): dry-run sync, circuit breaker, scheduler (M6), app Dockerfiles | |

## 10. Future improvements (in order)
1. Scheduler with node-cron (`CollectionService.start('SCHEDULED')` already supports the trigger value), then auto-sync.
2. Real AWS adapter (SDK v3 `DescribeInstances` across accounts/regions), then the others.
3. Run the HTTP gateway against `netbox-docker` in Compose; add an integration test stage.
4. Auth (OIDC) + roles for sync/remediation; audit log.
5. Job queue (e.g. pg-boss/BullMQ) for multiple instances; metrics (Prometheus) and alerting on failed runs.
6. Dockerfiles + CI running both test suites.

---

## 11. Likely questions and defensible answers

**Q: Why not microservices?**
A: Five adapters and one sync target don't need independent deployment. A monolith gives me transactions and one thing to run. Module boundaries are interfaces, so collectors could become workers later.

**Q: Is any of this connected to real clouds or NetBox?**
A: No, and the UI says so. Adapters read provider-shaped MOCK files; NetBox is a SIMULATION table. The live NetBox client is implemented against NetBox's documented endpoints and contract-tested with a fake server, but I have not run it against a real NetBox and don't claim it.

**Q: How do you add a real AWS adapter?**
A: Implement `ProviderAdapter` with the SDK call, return raw instances plus the account/region list with COMPLETE/FAILED status, reuse the existing raw schema and mapper, register it in `container.ts`. Normalization, persistence, sync and drift don't change.

**Q: How do you guarantee idempotency?**
A: Two fingerprints comparisons – at collection (row unchanged → heartbeat only) and at sync (`syncedFingerprint` equal → skip without calling NetBox). Plus matching by stored ID/serial so a re-run never creates a second record. Verified: 58 unchanged, 58 skipped on re-run.

**Q: What if AWS times out for one account?**
A: That account is reported FAILED; its VMs are not decommissioned; the provider result is FAILED or PARTIAL; other providers commit normally in their own transactions.

**Q: How do you prevent duplicates in NetBox?**
A: Scoped `externalId` written to NetBox's `serial`; matching by stored ID first, then serial; if several records share a serial the VM is marked DUPLICATE and nothing is written. Name collisions within a cluster are disambiguated.

**Q: Why not delete orphans automatically?**
A: NetBox is the source of truth and may contain records CloudVM doesn't own (manually added, other tools). Deleting on a possibly incomplete collection is irreversible. So orphans are reported with severity; a human decides.

**Q: Two users click "Run sync" at the same time?**
A: In-process lock + RUNNING-row guard → the second gets 409 with the running run's ID; the UI shows the message. Stale RUNNING rows (>15 min) are closed as FAILED so a crash doesn't block forever.

**Q: Why store `rawData`?**
A: Audit and debugging – you can see exactly what the provider returned when a normalized value looks wrong. It's excluded from list responses and from the fingerprint.

**Q: Why MiB/GiB?**
A: Providers mix units (bytes, MiB, GB-labelled-GiB). Picking binary units and converting once in the mapper avoids rounding drift; NetBox memory is sent as the MiB value and disk converted to MB.

**Q: What's untested or weakest?**
A: Real provider APIs and a real NetBox; behaviour with thousands of VMs (sync is sequential per VM); multi-instance locking. Those are the first things I'd address.

**Q: How did you test?**
A: Unit tests for mappers, normalization, reconciliation planning, sync decisions, drift rules; integration tests against a dedicated `cloudvm_test` PostgreSQL database (truncation refuses any DB not ending in `_test`); contract tests for the HTTP gateway against a fake server; verify scripts per milestone that run everything plus a live API demo; frontend tests with the API mocked.

**Q: Where did you use AI assistance?** *(answer honestly in your own words)*
A: Suggested framing: I used an AI assistant as a pair programmer for scaffolding and boilerplate; I reviewed every decision, raised design issues myself (scoped identity, AWS terminated handling, simulated-ID safety, zero-VM account reconciliation), ran all verification on my machine, and can explain each module.
