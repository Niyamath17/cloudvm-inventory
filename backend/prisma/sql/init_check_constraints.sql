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
