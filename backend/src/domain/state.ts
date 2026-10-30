/**
 * Provider state -> (PowerState, Lifecycle) mapping.
 *
 * Two separate questions, deliberately kept apart:
 *   1. Does the VM still EXIST?          -> Lifecycle (ACTIVE | DECOMMISSIONED)
 *   2. If it exists, is it switched on?  -> PowerState (RUNNING | STOPPED | SUSPENDED | UNKNOWN)
 *
 * A deleted VM has no meaningful power state, so it gets UNKNOWN, never STOPPED –
 * a terminated AWS instance can therefore never be counted as a "stopped VM".
 * The provider's original word is always preserved in rawPowerState.
 *
 * Only AWS reports deletion explicitly (instances stay visible for ~1 hour after
 * termination). For the other providers a deleted VM simply disappears from the
 * API; that case is detected by the collection orchestrator (M3) as
 * MISSING_FROM_PROVIDER – and only after a SUCCESSFUL collection of that account.
 */
import type { ProviderName } from './identity.js';

export type PowerStateValue = 'RUNNING' | 'STOPPED' | 'SUSPENDED' | 'UNKNOWN';

export type StateMapping =
  | { lifecycle: 'ACTIVE'; powerState: PowerStateValue; rawPowerState: string | null }
  | { lifecycle: 'DECOMMISSIONED'; powerState: 'UNKNOWN'; decommissionReason: 'PROVIDER_TERMINATED'; rawPowerState: string };

const active = (powerState: PowerStateValue, raw: string | null): StateMapping => ({
  lifecycle: 'ACTIVE',
  powerState,
  rawPowerState: raw,
});

const terminated = (raw: string): StateMapping => ({
  lifecycle: 'DECOMMISSIONED',
  powerState: 'UNKNOWN',
  decommissionReason: 'PROVIDER_TERMINATED',
  rawPowerState: raw,
});

/** Tables of the provider values CloudVM understands; anything else -> ACTIVE + UNKNOWN (never a guess). */
const TABLES: Record<ProviderName, Record<string, PowerStateValue | 'TERMINATED'>> = {
  // EC2 instance-state-name
  AWS: {
    pending: 'RUNNING', // starting up
    running: 'RUNNING',
    stopping: 'STOPPED',
    stopped: 'STOPPED',
    'shutting-down': 'TERMINATED', // termination in progress – the instance is being deleted
    terminated: 'TERMINATED', // deleted; AWS instance IDs are never reused
  },
  // Azure instanceView "PowerState/<x>" (x below)
  AZURE: {
    starting: 'RUNNING',
    running: 'RUNNING',
    stopping: 'STOPPED',
    stopped: 'STOPPED', // stopped but still allocated (still billed)
    deallocating: 'STOPPED',
    deallocated: 'STOPPED', // stopped and released (not billed) – still exists
  },
  // Compute Engine instance.status
  GCP: {
    PROVISIONING: 'RUNNING',
    STAGING: 'RUNNING',
    RUNNING: 'RUNNING',
    STOPPING: 'STOPPED',
    STOPPED: 'STOPPED',
    TERMINATED: 'STOPPED', // GCP "TERMINATED" means STOPPED – the instance still exists
    SUSPENDING: 'SUSPENDED',
    SUSPENDED: 'SUSPENDED',
    // REPAIRING -> UNKNOWN (not in table)
  },
  // /cluster/resources status
  PROXMOX: {
    running: 'RUNNING',
    stopped: 'STOPPED',
    paused: 'SUSPENDED',
    // "unknown" (node offline) -> UNKNOWN
  },
  // vSphere power_state
  VMWARE: {
    POWERED_ON: 'RUNNING',
    POWERED_OFF: 'STOPPED',
    SUSPENDED: 'SUSPENDED',
  },
};

export function mapProviderState(provider: ProviderName, rawState: string | null | undefined): StateMapping {
  const raw = rawState?.trim() || null;
  if (raw === null) return active('UNKNOWN', null);

  // Azure reports "PowerState/deallocated"; the table holds the part after the slash.
  const key = provider === 'AZURE' ? raw.replace(/^PowerState\//i, '').toLowerCase() : raw;
  const mapped = TABLES[provider][key];

  if (mapped === 'TERMINATED') return terminated(raw);
  return active(mapped ?? 'UNKNOWN', raw);
}
