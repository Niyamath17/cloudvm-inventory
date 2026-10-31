# CloudVM REST API

Base URL: `http://localhost:4000/api/v1` (the frontend calls `/api/v1/...` through the Vite proxy).

This document is written from the route implementations in `backend/src/modules/*/*.routes.ts` and `backend/src/app.ts`. Example values are **representative** (they come from the MOCK sample data); IDs are shortened UUIDs.

> **MOCK / SIMULATION:** every collection reads MOCK sample files (`dataSource: "MOCK"`). With the default `NETBOX_MODE=simulation`, sync and drift use the local NetBox stand-in and responses carry `target: "SIMULATION"` plus a `label` that says so. No real NetBox or cloud API is contacted.

## Conventions

- JSON in and out. No authentication (local prototype).
- Long-running operations (`POST /collections`, `POST /sync`) return **202 Accepted** with a run ID and run in the background. Poll the run endpoint until `status` is no longer `RUNNING`.
- Paginated lists return:
  ```json
  { "data": [ ... ], "pagination": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 } }
  ```
  `page` ≥ 1; `pageSize` 1–100 (default 20, except `/vms` default 25 and `/netbox/simulated-vms` max 200 / default 100).
- Path IDs are UUIDs; anything else returns `400 VALIDATION_ERROR`.
- Run `status` values: `RUNNING`, `SUCCESS`, `PARTIAL`, `FAILED`.
- Units: `memoryMb` = MiB, `diskGb` = GiB (binary).

## Errors

All errors share one shape (central handler in `src/middleware/errorHandler.ts`):

```json
{ "error": { "code": "NOT_FOUND", "message": "VM 3f2a… not found", "requestId": "7c1e…" } }
```
`details` is included only when the error carries extra information (validation issues, conflicting run ID).

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Query/path parameters fail Zod validation. `details` = `[{ "path": "pageSize", "message": "..." }]` |
| 400 | `INVALID_JSON` | Malformed JSON body |
| 404 | `NOT_FOUND` | Run, VM or report does not exist; also `GET /drift/reports/latest` when no report exists |
| 404 | `ROUTE_NOT_FOUND` | Unknown path, e.g. `No route for GET /api/v1/nope` |
| 409 | `CONFLICT` | A collection or synchronization is already running. `details` = `{ "runId": "..." }` when known |
| 500 | `INTERNAL_ERROR` | Unexpected error (logged with stack; generic message returned) |
| 503 | – | `GET /health` when PostgreSQL is unreachable (health body, not the error shape) |

Example 409:
```json
{ "error": { "code": "CONFLICT", "message": "A collection is already running", "details": { "runId": "9b0d…" }, "requestId": "…" } }
```

---

## Endpoint index

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | API + database health, configured NetBox mode |
| GET | `/dashboard/summary` | Dashboard statistics |
| GET | `/vms` | VM list – search, filter, sort, paginate |
| GET | `/vms/facets` | Values and counts for filters |
| GET | `/vms/:id` | One VM with raw payload, sync state and recent sync events |
| GET | `/providers` | Registered adapters (all MOCK) with last result and counts |
| POST | `/collections` | Start a manual collection (202) |
| GET | `/collections` | Collection history |
| GET | `/collections/:id` | One collection run with provider results |
| POST | `/sync` | Start a sync to the configured NetBox target (202) |
| GET | `/sync/runs` | Sync history |
| GET | `/sync/runs/:id` | One sync run with per-VM events |
| GET | `/netbox/status` | Configured NetBox mode/target |
| GET | `/netbox/simulated-vms` | Records in the simulated NetBox (SIMULATION mode only) |
| POST | `/drift/reports` | Generate a drift report (201) |
| GET | `/drift/reports` | Drift report history (no items) |
| GET | `/drift/reports/latest` | Newest report with items |
| GET | `/drift/reports/:id` | One report with items |
| POST | `/drift/reports/:id/remediate` | Mark fixable drift for re-sync |

There is **no scheduler endpoint** – scheduled collection (M6) is not implemented.

---

## Health

### `GET /health`
`200` when PostgreSQL is reachable, `503` with `status: "degraded"` when not.

```json
{
  "status": "ok",
  "service": "cloudvm-backend",
  "version": "0.1.0",
  "environment": "development",
  "timestamp": "2026-10-31T07:40:12.345Z",
  "uptimeSeconds": 512,
  "checks": {
    "database": { "status": "up", "latencyMs": 3, "serverVersion": "PostgreSQL 16.15" },
    "netbox": { "mode": "SIMULATION", "label": "Local simulation – no real NetBox instance is contacted" }
  }
}
```

---

## Dashboard

### `GET /dashboard/summary`
Counts and resources for the dashboard. `running/stopped/suspended/unknown` and `resources`/`providers` cover **ACTIVE** VMs only; `total` includes decommissioned VMs. `lastCollection`/`lastSync` are the newest finished runs (or `null`).

```json
{
  "dataSource": "MOCK",
  "vms": { "total": 58, "active": 56, "running": 39, "stopped": 13, "suspended": 2, "unknown": 2, "decommissioned": 2 },
  "resources": { "cpuCores": 318, "memoryMb": 1302528, "diskGb": 8960 },
  "providers": [
    { "provider": "AWS", "vms": 12, "cpuCores": 58, "memoryMb": 237568, "diskGb": 1240 },
    { "provider": "AZURE", "vms": 11, "cpuCores": 52, "memoryMb": 212992, "diskGb": 1408 }
  ],
  "lastCollection": { "id": "c1…", "status": "SUCCESS", "trigger": "MANUAL", "startedAt": "2026-10-31T07:30:00.000Z", "finishedAt": "2026-10-31T07:30:00.412Z" },
  "lastSync": {
    "id": "s1…", "target": "SIMULATION", "status": "SUCCESS",
    "startedAt": "2026-10-31T07:31:00.000Z", "finishedAt": "2026-10-31T07:31:00.880Z",
    "createdCount": 57, "updatedCount": 0, "decommissionedCount": 0, "skippedCount": 1, "failedCount": 0, "duplicateCount": 0,
    "simulated": true
  }
}
```
*(Numbers illustrative; the UI shows whatever the database returns.)*

---

## Inventory

### `GET /vms`

| Query | Type | Default | Notes |
|---|---|---|---|
| `page` | int ≥ 1 | 1 | |
| `pageSize` | int 1–100 | 25 | |
| `search` | string ≤ 100 | – | Case-insensitive *contains* on `name`, `hostname`, `externalId`, `nativeId`, `osName`, `owner`; **exact** match on an IP address |
| `provider` | CSV | – | `AWS,AZURE,GCP,PROXMOX,VMWARE` (case-insensitive) |
| `powerState` | CSV | – | `RUNNING,STOPPED,SUSPENDED,UNKNOWN` |
| `lifecycle` | enum | `ALL` | `ACTIVE`, `DECOMMISSIONED`, `ALL` |
| `region`, `cluster`, `owner` | string | – | Exact match |
| `sortBy` | enum | `name` | `name, provider, region, cluster, powerState, cpuCores, memoryMb, diskGb, owner, lastDiscoveredAt` (nullable fields sort nulls last; `id` is the tie-breaker) |
| `sortOrder` | `asc`/`desc` | `asc` | |

`rawData` is omitted from list rows.

```bash
curl -s "http://localhost:4000/api/v1/vms?provider=aws,gcp&powerState=RUNNING&sortBy=memoryMb&sortOrder=desc&pageSize=2"
```
```json
{
  "data": [
    {
      "id": "5d7e…",
      "provider": "AWS",
      "externalId": "123456789012/ap-south-1/i-0a1b2c3d4e5f60001",
      "nativeId": "i-0a1b2c3d4e5f60001",
      "account": "123456789012",
      "name": "web-prod-01",
      "hostname": "ip-10-10-1-21.ap-south-1.compute.internal",
      "ipAddresses": ["10.10.1.21"],
      "osName": "Linux/UNIX",
      "cpuCores": 4,
      "memoryMb": 16384,
      "diskGb": 100,
      "region": "ap-south-1",
      "cluster": "ap-south-1a",
      "powerState": "RUNNING",
      "rawPowerState": "running",
      "owner": "platform-team",
      "tags": { "Environment": "prod" },
      "dataSource": "MOCK",
      "lifecycle": "ACTIVE",
      "decommissionedAt": null,
      "decommissionReason": null,
      "fingerprint": "9f3c…",
      "firstDiscoveredAt": "2026-10-31T07:30:00.401Z",
      "lastDiscoveredAt": "2026-10-31T07:45:00.390Z",
      "createdAt": "2026-10-31T07:30:00.401Z",
      "updatedAt": "2026-10-31T07:30:00.401Z"
    }
  ],
  "pagination": { "page": 1, "pageSize": 2, "total": 17, "totalPages": 9 }
}
```
*(Row fields are all `VirtualMachine` columns except `rawData`; see `docs/DATABASE.md`. Example values illustrative.)*

Invalid parameter → `400`:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [{ "path": "pageSize", "message": "<Zod message, e.g. number too big>" }], "requestId": "…" } }
```

### `GET /vms/facets`
```json
{
  "providers":   [{ "value": "AWS", "count": 12 }, { "value": "AZURE", "count": 11 }],
  "powerStates": [{ "value": "RUNNING", "count": 39 }, { "value": "STOPPED", "count": 13 }],
  "lifecycles":  [{ "value": "ACTIVE", "count": 56 }, { "value": "DECOMMISSIONED", "count": 2 }],
  "regions":  ["ap-south-1", "asia-south1", "centralindia"],
  "clusters": ["Prod-Cluster-01", "pve-dc1"],
  "owners":   ["data-team", "platform-team"]
}
```
Facet counts include decommissioned VMs.

### `GET /vms/:id`
A full VM row **including `rawData`** (the original MOCK provider record), plus:
- `syncStates`: one row per target – `{ target, state (PENDING|SYNCED|FAILED|DUPLICATE), netboxId, simulatedVmId, syncedFingerprint, lastSyncedAt, lastError, ... }`
- `syncEvents`: the 20 most recent sync events for this VM, newest first.

`404 NOT_FOUND` if the ID does not exist.

---

## Providers

### `GET /providers`
```json
{
  "data": [
    {
      "provider": "AWS",
      "dataSource": "MOCK",
      "label": "MOCK adapter – sample data, not a real provider API",
      "vmCounts": { "active": 12, "decommissioned": 1 },
      "lastResult": {
        "id": "…", "runId": "c1…", "provider": "AWS", "dataSource": "MOCK", "status": "SUCCESS",
        "vmCount": 13, "invalidCount": 0, "durationMs": 4, "error": null,
        "run": { "id": "c1…", "startedAt": "…", "finishedAt": "…" }
      }
    }
  ]
}
```
`lastResult` is `null` before the first collection.

---

## Collections

### `POST /collections`
Starts a **MANUAL** collection from all five MOCK adapters. No body.

`202 Accepted`
```json
{ "runId": "c1…", "status": "RUNNING", "dataSource": "MOCK" }
```
`409 CONFLICT` – "A collection is already running". (A RUNNING row older than 15 minutes is treated as abandoned and closed as FAILED.)

### `GET /collections?page=&pageSize=`
Newest first; each run includes `providerResults` (ordered by provider).

### `GET /collections/:id`
```json
{
  "id": "c1…",
  "trigger": "MANUAL",
  "status": "SUCCESS",
  "startedAt": "2026-10-31T07:30:00.000Z",
  "finishedAt": "2026-10-31T07:30:00.412Z",
  "discoveredCount": 58,
  "createdCount": 0,
  "updatedCount": 0,
  "unchangedCount": 58,
  "decommissionedCount": 0,
  "invalidCount": 0,
  "errors": [],
  "providerResults": [
    { "id": "…", "runId": "c1…", "provider": "AWS", "dataSource": "MOCK", "status": "SUCCESS", "vmCount": 13, "invalidCount": 0, "durationMs": 4, "error": null }
  ]
}
```
This example is a **repeat** collection: verified on the development Mac, a second collection reports 58 unchanged and 0 created/updated/decommissioned.

`errors` entries: `{ provider, ref?, stage?, message }` – e.g. a rejected record (`stage` = validation step) or a failed account (`stage: "account"`). A provider whose adapter fails gets `status: "FAILED"` and the run becomes `PARTIAL`; VMs of failed providers/accounts are **not** decommissioned.

---

## Synchronization

### `POST /sync`
Syncs every VM to the configured target. No body.

`202 Accepted`
```json
{ "syncRunId": "s1…", "status": "RUNNING", "target": "SIMULATION", "label": "SIMULATION – local stand-in, no real NetBox instance is contacted" }
```
`409 CONFLICT` – "A synchronization is already running".

### `GET /sync/runs?page=&pageSize=`
Sync runs newest first (no events): `id, target, status, dryRun, collectionRunId, startedAt, finishedAt, createdCount, updatedCount, decommissionedCount, skippedCount, failedCount, duplicateCount, error`.

### `GET /sync/runs/:id`
```json
{
  "id": "s2…",
  "target": "SIMULATION",
  "status": "SUCCESS",
  "dryRun": false,
  "collectionRunId": null,
  "startedAt": "2026-10-31T07:32:00.000Z",
  "finishedAt": "2026-10-31T07:32:00.150Z",
  "createdCount": 0, "updatedCount": 0, "decommissionedCount": 0,
  "skippedCount": 58, "failedCount": 0, "duplicateCount": 0,
  "error": null,
  "label": "SIMULATION – local stand-in, no real NetBox instance is contacted",
  "events": []
}
```
This is the verified idempotent re-run (second sync: 58 skipped, nothing written). Unchanged VMs are counted in `skippedCount` but produce **no event**.

Event shape (runs that write):
```json
{
  "id": "e1…", "syncRunId": "s1…", "vmId": "5d7e…", "vmName": "db-prod-01",
  "action": "UPDATE", "success": true, "remoteId": 14, "httpStatus": null, "error": null,
  "diff": { "memory": { "from": 1024, "to": 16384 } },
  "createdAt": "…"
}
```
- `action`: `CREATE | UPDATE | DECOMMISSION | SKIP`
- `remoteId`: record ID in the target (simulated ID in SIMULATION mode)
- `httpStatus`: only for the live NETBOX target
- A duplicate is recorded as `action: "SKIP"`, `success: false`, `error: "DUPLICATE: <n> records with serial <serial> – not written"`.

---

## NetBox

### `GET /netbox/status`
SIMULATION mode (default):
```json
{ "mode": "SIMULATION", "target": "SIMULATION", "label": "SIMULATION – local stand-in, no real NetBox instance is contacted", "simulatedRecords": 57 }
```
LIVE mode (not exercised against a real NetBox in this project): `200 { mode: "LIVE", target: "NETBOX", label, reachable: true, netboxVersion }` or `503 { mode: "LIVE", target: "NETBOX", label, reachable: false, error }`.

### `GET /netbox/simulated-vms?page=&pageSize=`
SIMULATION mode only (`404 NOT_FOUND` in live mode). `pageSize` max 200, default 100.
```json
{
  "label": "SIMULATION – local stand-in, no real NetBox instance is contacted",
  "data": [
    { "id": 1, "name": "web-prod-01", "clusterName": "AWS/ap-south-1a", "status": "active", "serial": "aws:123456789012/ap-south-1/i-0a1b2c3d4e5f60001", "vcpus": 4, "memory": 16384, "disk": 102400, "tags": [], "description": null, "createdAt": "…", "updatedAt": "…" }
  ],
  "pagination": { "page": 1, "pageSize": 100, "total": 57, "totalPages": 1 }
}
```
*(Columns are exactly those of `SimulatedNetboxVm` in `prisma/schema.prisma`; values illustrative. `memory` and `disk` use NetBox's units – memory in MB (CloudVM sends MiB values) and disk in MB.)*

---

## Drift

All drift responses carry `target` and a `label` (`"SIMULATION – compared with the local NetBox stand-in, not a real NetBox"`).

### `POST /drift/reports`
Generates a report now. No body. `201 Created`:
```json
{
  "id": "d1…",
  "target": "SIMULATION",
  "generatedAt": "2026-10-31T07:35:00.000Z",
  "totalItems": 5,
  "summary": {
    "totalItems": 5,
    "byType": { "MISSING_IN_NETBOX": 1, "ORPHAN_IN_NETBOX": 1, "RESOURCE_MISMATCH": 1, "POWER_STATE_MISMATCH": 1, "DUPLICATE": 1 },
    "bySeverity": { "INFO": 0, "WARNING": 4, "CRITICAL": 1 },
    "comparedLocal": 58,
    "comparedRemote": 58
  },
  "label": "SIMULATION – compared with the local NetBox stand-in, not a real NetBox"
}
```
*(Shape exact; counts illustrative – the verified M5 demo produced 5 findings, one of each type. Severity depends on the rule: DUPLICATE = CRITICAL; orphans = WARNING if CloudVM-managed, INFO otherwise.)*

### `GET /drift/reports?page=&pageSize=`
Report history newest first, without items.

### `GET /drift/reports/latest?type=&severity=` · `GET /drift/reports/:id?type=&severity=`
Report plus `items`, ordered by severity, type, name. Optional filters: `type` ∈ `MISSING_IN_NETBOX, ORPHAN_IN_NETBOX, RESOURCE_MISMATCH, POWER_STATE_MISMATCH, DUPLICATE`; `severity` ∈ `INFO, WARNING, CRITICAL`. `latest` returns `404 NOT_FOUND` ("No drift report yet") when none exists.

Item shape:
```json
{
  "id": "i1…", "reportId": "d1…",
  "type": "RESOURCE_MISMATCH", "severity": "WARNING",
  "vmId": "5d7e…", "remoteId": 1, "name": "web-prod-01",
  "field": "memory", "expected": "16384", "actual": "1024"
}
```
`expected` = collected inventory value, `actual` = value in the target. `vmId` is null for orphans; `remoteId` is null for VMs missing in NetBox.

### `POST /drift/reports/:id/remediate`
Resets the sync state of VMs with `MISSING_IN_NETBOX`, `RESOURCE_MISMATCH` or `POWER_STATE_MISMATCH` findings so the next `POST /sync` corrects the target. **Nothing is written to NetBox by this call, and nothing is ever deleted.**
```json
{
  "markedForResync": 3,
  "manualActionRequired": 2,
  "next": "POST /api/v1/sync to push corrections; ORPHAN and DUPLICATE findings need a manual decision (records are never deleted automatically)"
}
```
`404 NOT_FOUND` if the report does not exist.

---

## Typical sequence

```bash
API=http://localhost:4000/api/v1
RUN=$(curl -s -X POST $API/collections | node -pe 'JSON.parse(require("fs").readFileSync(0)).runId')
curl -s $API/collections/$RUN                       # poll until status != RUNNING
SYNC=$(curl -s -X POST $API/sync | node -pe 'JSON.parse(require("fs").readFileSync(0)).syncRunId')
curl -s $API/sync/runs/$SYNC                        # poll; then repeat POST /sync → all skipped
curl -s -X POST $API/drift/reports                  # 201, totalItems 0 on a clean simulation
```
