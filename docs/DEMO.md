# CloudVM – Five-Minute Technical Demo

**Goal:** show the full pipeline (collect → normalize → persist → sync → drift → remediate) end to end, show that it is idempotent, and be explicit about what is simulated.

> **Say this up front (15 s):** "All five provider adapters read **MOCK** sample files shaped like the real provider API responses – no cloud credentials are used. NetBox runs in **SIMULATION** mode: writes go to a local table that follows NetBox's rules. A real NetBox REST client exists but has only been tested against a fake HTTP server. The scheduler is not implemented yet; everything is triggered manually."

---

## Before the demo (2 minutes, not on the clock)

```bash
cd ~/Desktop/CloudVM
docker compose up -d postgres                   # wait for "healthy"
cd backend && npm run dev                       # terminal 1 → http://localhost:4000/api/v1
cd frontend && npm run dev                      # terminal 2 → http://localhost:5173
```

Optional clean slate (deletes **all** local CloudVM data in the dev database):
```bash
docker exec -it cloudvm-postgres psql -U cloudvm -d cloudvm -c \
  "TRUNCATE drift_items, drift_reports, sync_events, sync_runs, vm_sync_states, simulated_netbox_vms, provider_run_results, collection_runs, virtual_machines CASCADE;"
```
(User/database names are the defaults from `.env.example`; adjust if yours differ.)

Have three tabs ready: the UI, a terminal for `curl`, and `docs/API.md`.

---

## 0:00 – 0:45 · Architecture in one picture
Open `README.md` → Architecture diagram.
- Modular monolith: React UI → Express API → services → PostgreSQL via Prisma.
- Five adapters behind one `ProviderAdapter` interface; a pure mapper per provider produces one `NormalizedVm` model.
- `NetBoxGateway` interface with two implementations: **SimulatedNetBoxGateway (active)** and HttpNetBoxGateway (live, not tested against real NetBox). Chosen in one line in `container.ts` from `NETBOX_MODE`.

## 0:45 – 1:45 · Collection workflow (Jobs, Dashboard)
1. **Jobs → Run collection.** Point at the scheduler card: **NOT IMPLEMENTED** – manual trigger only.
2. Expand the new run: five provider cards, each with a **MOCK** badge, VM count, invalid count, duration.
   - First run on an empty DB: 58 created (60 sample entries; one Proxmox template and one LXC container are skipped by design).
3. **Dashboard:** totals, running/stopped/decommissioned, VMs by provider, capacity in GiB/TiB. Every number comes from `GET /dashboard/summary` – nothing hard-coded.
   - Decommissioned includes the AWS instance whose state is `terminated` (lifecycle is separate from power state).

## 1:45 – 2:30 · Inventory and normalization
1. **Inventory:** search `10.` or a hostname, filter AWS + GCP, sort by RAM, page through.
2. Open a VM drawer → show:
   - **Scoped ID** (`<account>/<region>/<instance-id>` for AWS) vs native ID – why: the same instance ID in two accounts must not collide. Database enforces `UNIQUE(provider, externalId)`.
   - Units normalized to MiB / GiB; missing fields shown as "—", not invented.
   - **Raw MOCK payload** – the original provider-shaped record we normalized from.

## 2:30 – 3:15 · NetBox SIMULATION sync + idempotency
1. **Synchronization:** point at the purple **SIMULATION** banner and the record count.
2. **Run sync** → message ends with *"No real NetBox was contacted."* Tiles: created / updated / decommissioned / skipped / failed / duplicate. Click the run → per-VM CREATE events.
   - The terminated AWS VM that was never in NetBox is skipped – dead VMs are not created.
3. **Idempotency:** click **Run sync** again → **0 created, 0 updated, everything skipped**, and the events table explains that unchanged VMs are skipped without any gateway call (fingerprint equals the fingerprint stored at last sync).
4. Same for collection: **Jobs → Run collection** again → *unchanged* = 58, nothing created/updated/decommissioned.

Verified on the development Mac by `scripts/verify-m3.sh` (58 unchanged) and `scripts/verify-m4.sh` (second sync: 58 skipped).

## 3:15 – 4:30 · Drift detection and remediation
1. **Drift → Generate report** → **0 findings** on a freshly synced simulation.
2. Introduce drift by editing the **simulated** NetBox table directly (this stands in for someone changing NetBox by hand). Run in the terminal:
   ```bash
   SQL() { docker exec -i cloudvm-postgres psql -U cloudvm -d cloudvm -q -c "$1"; }
   SQL "UPDATE simulated_netbox_vms SET memory = 1024 WHERE serial = 'aws:123456789012/ap-south-1/i-0a1b2c3d4e5f60001';"
   SQL "UPDATE simulated_netbox_vms SET status = 'offline' WHERE serial = 'gcp:cloudvm-demo-project/4417300000000000005';"
   SQL "DELETE FROM simulated_netbox_vms WHERE serial = 'proxmox:pve-dc1/101';"
   SQL "INSERT INTO simulated_netbox_vms (name, \"clusterName\", status, serial, tags, \"updatedAt\") VALUES ('legacy-vm-x', 'AWS/ap-south-1a', 'active', 'aws:123456789012/ap-south-1/i-deadbeef00000000', '{}', now());"
   SQL "INSERT INTO simulated_netbox_vms (name, \"clusterName\", status, serial, tags, \"updatedAt\") VALUES ('oracle-db-01-copy', 'VMWARE/Prod-Cluster-01', 'active', 'vmware:vcsa01.corp.example.com/50000004-1a2b-4c3d-8e9f-0a1b2c3d4e5f', '{}', now());"
   ```
   These are the same statements `scripts/verify-m5.sh` uses.
3. **Generate report** → **5 findings, one of each type**: resource mismatch (memory), power-state mismatch, missing in NetBox, orphan in NetBox, duplicate (CRITICAL). Click a type card to filter; show *collected* vs *NetBox* values.
4. **Mark for re-sync → Confirm.** Explain: this only resets sync state for the 3 fixable findings; **orphans and duplicates are labelled "Manual review" and there is no delete button** – automatic deletion from a source of truth is too risky.
5. **Run sync & re-check** → sync recreates/updates the 3 records → new report shows the **2 manual** findings (orphan + duplicate) remaining.
6. Resolve them manually (a human decision), then regenerate → **0 findings**:
   ```bash
   SQL "DELETE FROM simulated_netbox_vms WHERE name IN ('legacy-vm-x', 'oracle-db-01-copy');"
   ```
   The 0 → 5 → 0 sequence is what `verify-m5.sh` checked on the Mac.

## 4:30 – 5:00 · Wrap-up
- **Real:** normalization, persistence, reconciliation, idempotency, locking, sync decision logic, drift engine, UI – all tested (283 backend tests at M5, 25 frontend tests).
- **Simulated:** provider data (MOCK) and the NetBox target (SIMULATION).
- **Not built:** scheduler (M6), auth, Docker images for app containers.
- **Next:** scheduler; first real adapter (AWS SDK v3); run the HTTP gateway against `netbox-docker`.

---

## Backup: same flow with curl (if the UI misbehaves)

```bash
API=http://localhost:4000/api/v1
curl -s -X POST $API/collections                     # → 202 { runId }
curl -s "$API/collections?pageSize=1"                # latest run + providerResults
curl -s -X POST $API/collections & curl -s -X POST $API/collections; wait   # concurrent → one 202, one 409 CONFLICT (lock)
curl -s -X POST $API/sync                            # → 202 { syncRunId, target: "SIMULATION" }
curl -s "$API/sync/runs?pageSize=2"                  # compare first and second run counts
curl -s -X POST $API/drift/reports                   # → 201 with summary
curl -s $API/drift/reports/latest                    # items
curl -s -X POST $API/drift/reports/<id>/remediate    # → markedForResync / manualActionRequired
```
The two concurrent `POST /collections` demonstrate the lock: one 202, one 409 (`verify-m3.sh` checked exactly this).

## Questions you may get during the demo
- *"Is this hitting AWS?"* – No. MOCK adapters read `backend/sample-data/*.json`; each file says `_meta.mock: true`.
- *"Did you test against NetBox?"* – Not a real instance. The HTTP gateway uses NetBox's documented endpoints and is contract-tested against a local fake server; the simulation mirrors NetBox's uniqueness and status rules.
- *"What happens if one provider is down?"* – That provider's result is FAILED, the run is PARTIAL, and its VMs are **not** decommissioned (only completely queried accounts are reconciled).
