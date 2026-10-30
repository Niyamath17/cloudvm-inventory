-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('AWS', 'AZURE', 'GCP', 'PROXMOX', 'VMWARE');

-- CreateEnum
CREATE TYPE "PowerState" AS ENUM ('RUNNING', 'STOPPED', 'SUSPENDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Lifecycle" AS ENUM ('ACTIVE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "DecommissionReason" AS ENUM ('PROVIDER_TERMINATED', 'MISSING_FROM_PROVIDER');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('MOCK', 'LIVE');

-- CreateEnum
CREATE TYPE "SyncTarget" AS ENUM ('NETBOX', 'SIMULATION');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('MANUAL', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "SyncAction" AS ENUM ('CREATE', 'UPDATE', 'DECOMMISSION', 'SKIP');

-- CreateEnum
CREATE TYPE "SyncState" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "DriftType" AS ENUM ('MISSING_IN_NETBOX', 'ORPHAN_IN_NETBOX', 'RESOURCE_MISMATCH', 'POWER_STATE_MISMATCH', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "DriftSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "virtual_machines" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "nativeId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT,
    "ipAddresses" TEXT[],
    "osName" TEXT,
    "cpuCores" INTEGER,
    "memoryMb" INTEGER,
    "diskGb" INTEGER,
    "region" TEXT,
    "cluster" TEXT,
    "powerState" "PowerState" NOT NULL DEFAULT 'UNKNOWN',
    "rawPowerState" TEXT,
    "owner" TEXT,
    "tags" JSONB NOT NULL DEFAULT '{}',
    "dataSource" "DataSource" NOT NULL,
    "rawData" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "lifecycle" "Lifecycle" NOT NULL DEFAULT 'ACTIVE',
    "decommissionedAt" TIMESTAMP(3),
    "decommissionReason" "DecommissionReason",
    "firstDiscoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDiscoveredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtual_machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vm_sync_states" (
    "id" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "target" "SyncTarget" NOT NULL,
    "netboxId" INTEGER,
    "simulatedVmId" INTEGER,
    "state" "SyncState" NOT NULL DEFAULT 'PENDING',
    "syncedFingerprint" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vm_sync_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_runs" (
    "id" TEXT NOT NULL,
    "trigger" "RunTrigger" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "discoveredCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "decommissionedCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "collection_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_run_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "dataSource" "DataSource" NOT NULL,
    "status" "RunStatus" NOT NULL,
    "vmCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "provider_run_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "target" "SyncTarget" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "collectionRunId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "decommissionedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_events" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "vmId" TEXT,
    "vmName" TEXT NOT NULL,
    "action" "SyncAction" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "remoteId" INTEGER,
    "httpStatus" INTEGER,
    "error" TEXT,
    "diff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drift_reports" (
    "id" TEXT NOT NULL,
    "target" "SyncTarget" NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "drift_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drift_items" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "type" "DriftType" NOT NULL,
    "severity" "DriftSeverity" NOT NULL DEFAULT 'WARNING',
    "vmId" TEXT,
    "remoteId" INTEGER,
    "name" TEXT NOT NULL,
    "field" TEXT,
    "expected" TEXT,
    "actual" TEXT,

    CONSTRAINT "drift_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulated_netbox_vms" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "clusterName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "serial" TEXT,
    "vcpus" DOUBLE PRECISION,
    "memory" INTEGER,
    "disk" INTEGER,
    "tags" TEXT[],
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simulated_netbox_vms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "virtual_machines_provider_account_idx" ON "virtual_machines"("provider", "account");

-- CreateIndex
CREATE INDEX "virtual_machines_lifecycle_powerState_idx" ON "virtual_machines"("lifecycle", "powerState");

-- CreateIndex
CREATE INDEX "virtual_machines_name_idx" ON "virtual_machines"("name");

-- CreateIndex
CREATE INDEX "virtual_machines_lastDiscoveredAt_idx" ON "virtual_machines"("lastDiscoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_machines_provider_externalId_key" ON "virtual_machines"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "vm_sync_states_netboxId_key" ON "vm_sync_states"("netboxId");

-- CreateIndex
CREATE UNIQUE INDEX "vm_sync_states_simulatedVmId_key" ON "vm_sync_states"("simulatedVmId");

-- CreateIndex
CREATE INDEX "vm_sync_states_target_state_idx" ON "vm_sync_states"("target", "state");

-- CreateIndex
CREATE UNIQUE INDEX "vm_sync_states_vmId_target_key" ON "vm_sync_states"("vmId", "target");

-- CreateIndex
CREATE INDEX "collection_runs_startedAt_idx" ON "collection_runs"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_run_results_runId_provider_key" ON "provider_run_results"("runId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "sync_runs_collectionRunId_key" ON "sync_runs"("collectionRunId");

-- CreateIndex
CREATE INDEX "sync_runs_target_startedAt_idx" ON "sync_runs"("target", "startedAt");

-- CreateIndex
CREATE INDEX "sync_events_syncRunId_idx" ON "sync_events"("syncRunId");

-- CreateIndex
CREATE INDEX "sync_events_vmId_idx" ON "sync_events"("vmId");

-- CreateIndex
CREATE INDEX "drift_reports_target_generatedAt_idx" ON "drift_reports"("target", "generatedAt");

-- CreateIndex
CREATE INDEX "drift_items_reportId_type_idx" ON "drift_items"("reportId", "type");

-- CreateIndex
CREATE INDEX "simulated_netbox_vms_serial_idx" ON "simulated_netbox_vms"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "simulated_netbox_vms_clusterName_name_key" ON "simulated_netbox_vms"("clusterName", "name");

-- AddForeignKey
ALTER TABLE "vm_sync_states" ADD CONSTRAINT "vm_sync_states_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "virtual_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vm_sync_states" ADD CONSTRAINT "vm_sync_states_simulatedVmId_fkey" FOREIGN KEY ("simulatedVmId") REFERENCES "simulated_netbox_vms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_run_results" ADD CONSTRAINT "provider_run_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "collection_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_collectionRunId_fkey" FOREIGN KEY ("collectionRunId") REFERENCES "collection_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "virtual_machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_items" ADD CONSTRAINT "drift_items_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "drift_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drift_items" ADD CONSTRAINT "drift_items_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "virtual_machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- CloudVM – CHECK constraints for the `init` migration.
--
-- Prisma's schema language cannot express CHECK constraints, so these are appended
-- to prisma/migrations/<timestamp>_init/migration.sql before it is applied
-- (`prisma migrate dev --create-only`, append this file, then `prisma migrate dev`).
-- Both are verified by tests/integration/schema.test.ts and scripts/verify-m1.sh.

-- 1. Real NetBox IDs and simulated IDs can never be mixed:
--    a NETBOX row may only carry netboxId, a SIMULATION row only simulatedVmId.
ALTER TABLE "vm_sync_states"
  ADD CONSTRAINT "vm_sync_states_target_id_check" CHECK (
    ("target" = 'NETBOX'     AND "simulatedVmId" IS NULL) OR
    ("target" = 'SIMULATION' AND "netboxId"      IS NULL)
  );

-- 2. Lifecycle fields stay consistent: an ACTIVE VM has no decommission data,
--    a DECOMMISSIONED VM always records when and why.
ALTER TABLE "virtual_machines"
  ADD CONSTRAINT "virtual_machines_lifecycle_check" CHECK (
    ("lifecycle" = 'ACTIVE'         AND "decommissionedAt" IS NULL     AND "decommissionReason" IS NULL) OR
    ("lifecycle" = 'DECOMMISSIONED' AND "decommissionedAt" IS NOT NULL AND "decommissionReason" IS NOT NULL)
  );
