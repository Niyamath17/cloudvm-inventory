/**
 * Drift engine – compares CloudVM inventory with NetBox records. Pure function, no I/O.
 *
 * Matching key: NetBox `serial` = "<provider>:<externalId>" (the same key sync writes).
 *
 *   Type                  When                                                         Severity
 *   MISSING_IN_NETBOX     ACTIVE VM, no NetBox record with its serial                  WARNING
 *   ORPHAN_IN_NETBOX      NetBox record whose serial matches no CloudVM VM
 *                           - serial in CloudVM format (managed record, VM gone)       WARNING
 *                           - no / foreign serial (not managed by CloudVM)             INFO
 *   DUPLICATE             2+ NetBox records share one VM's serial                      CRITICAL
 *   POWER_STATE_MISMATCH  NetBox status ≠ status CloudVM would write                   WARNING
 *                           - NetBox "decommissioning" but VM ACTIVE, or VM
 *                             DECOMMISSIONED but NetBox not "decommissioning"          CRITICAL
 *   RESOURCE_MISMATCH     vcpus / memory (MiB) / disk (GiB×1024 MB) differ             WARNING
 *                         name / cluster differ                                        INFO
 *
 * Not compared (to avoid false drift): UNKNOWN power state (CloudVM never writes a guess),
 * resource values CloudVM doesn't know (null), the disambiguated name used for duplicate
 * names, and DECOMMISSIONED VMs that never existed in NetBox.
 */
import { netboxSerial } from '../../domain/identity.js';
import { clusterFor, disambiguatedName, statusFor } from '../netbox/mapping.js';
import type { NbVm } from '../netbox/NetBoxGateway.js';

export type DriftType = 'MISSING_IN_NETBOX' | 'ORPHAN_IN_NETBOX' | 'RESOURCE_MISMATCH' | 'POWER_STATE_MISMATCH' | 'DUPLICATE';
export type DriftSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface LocalVm {
  id: string;
  provider: 'AWS' | 'AZURE' | 'GCP' | 'PROXMOX' | 'VMWARE';
  externalId: string;
  nativeId: string;
  account: string;
  name: string;
  region: string | null;
  cluster: string | null;
  cpuCores: number | null;
  memoryMb: number | null;
  diskGb: number | null;
  powerState: 'RUNNING' | 'STOPPED' | 'SUSPENDED' | 'UNKNOWN';
  lifecycle: 'ACTIVE' | 'DECOMMISSIONED';
}

export interface DriftFinding {
  type: DriftType;
  severity: DriftSeverity;
  vmId: string | null;
  remoteId: number | null;
  name: string;
  field: string | null;
  expected: string | null; // collected inventory
  actual: string | null; // NetBox
}

export interface DriftSummary {
  totalItems: number;
  byType: Record<DriftType, number>;
  bySeverity: Record<DriftSeverity, number>;
  comparedLocal: number;
  comparedRemote: number;
}

const CLOUDVM_SERIAL = /^(aws|azure|gcp|proxmox|vmware):/;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export function detectDrift(local: LocalVm[], remote: NbVm[]): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const bySerial = new Map<string, NbVm[]>();
  for (const r of remote) {
    if (!r.serial) continue;
    bySerial.set(r.serial, [...(bySerial.get(r.serial) ?? []), r]);
  }
  const matchedRemote = new Set<number>();

  for (const vm of local) {
    const serial = netboxSerial(vm);
    const matches = bySerial.get(serial) ?? [];
    matches.forEach((m) => matchedRemote.add(m.id));
    const base = { vmId: vm.id, name: vm.name };

    if (matches.length > 1) {
      findings.push({ ...base, type: 'DUPLICATE', severity: 'CRITICAL', remoteId: matches[0]?.id ?? null, field: 'serial', expected: '1 record', actual: `${matches.length} records (ids ${matches.map((m) => m.id).join(', ')})` });
      continue;
    }
    const r = matches[0];
    if (!r) {
      if (vm.lifecycle === 'ACTIVE') findings.push({ ...base, type: 'MISSING_IN_NETBOX', severity: 'WARNING', remoteId: null, field: null, expected: serial, actual: null });
      continue;
    }

    // Status / lifecycle
    const expectedStatus = statusFor(vm);
    if (expectedStatus !== undefined && r.status !== expectedStatus) {
      const critical = expectedStatus === 'decommissioning' || r.status === 'decommissioning';
      findings.push({ ...base, type: 'POWER_STATE_MISMATCH', severity: critical ? 'CRITICAL' : 'WARNING', remoteId: r.id, field: 'status', expected: expectedStatus, actual: str(r.status) });
    }
    if (vm.lifecycle === 'DECOMMISSIONED') continue; // resources of a dead VM don't matter

    // Resources
    const resources: Array<[string, number | null, number | null]> = [
      ['vcpus', vm.cpuCores, r.vcpus],
      ['memory', vm.memoryMb, r.memory],
      ['disk', vm.diskGb === null ? null : vm.diskGb * 1024, r.disk],
    ];
    for (const [field, expected, actual] of resources) {
      if (expected !== null && expected !== actual) {
        findings.push({ ...base, type: 'RESOURCE_MISMATCH', severity: 'WARNING', remoteId: r.id, field, expected: str(expected), actual: str(actual) });
      }
    }
    // Configuration
    if (r.name !== vm.name && r.name !== disambiguatedName(vm)) {
      findings.push({ ...base, type: 'RESOURCE_MISMATCH', severity: 'INFO', remoteId: r.id, field: 'name', expected: vm.name, actual: r.name });
    }
    const cluster = clusterFor(vm).name;
    if (r.cluster !== cluster) {
      findings.push({ ...base, type: 'RESOURCE_MISMATCH', severity: 'INFO', remoteId: r.id, field: 'cluster', expected: cluster, actual: str(r.cluster) });
    }
  }

  for (const r of remote) {
    if (matchedRemote.has(r.id)) continue;
    const managed = !!r.serial && CLOUDVM_SERIAL.test(r.serial);
    findings.push({
      type: 'ORPHAN_IN_NETBOX',
      severity: managed ? 'WARNING' : 'INFO',
      vmId: null,
      remoteId: r.id,
      name: r.name,
      field: 'serial',
      expected: managed ? 'a VM in CloudVM inventory' : 'not managed by CloudVM',
      actual: str(r.serial),
    });
  }
  return findings;
}

export function summarize(findings: DriftFinding[], comparedLocal: number, comparedRemote: number): DriftSummary {
  const byType: Record<DriftType, number> = { MISSING_IN_NETBOX: 0, ORPHAN_IN_NETBOX: 0, RESOURCE_MISMATCH: 0, POWER_STATE_MISMATCH: 0, DUPLICATE: 0 };
  const bySeverity: Record<DriftSeverity, number> = { INFO: 0, WARNING: 0, CRITICAL: 0 };
  for (const f of findings) {
    byType[f.type] += 1;
    bySeverity[f.severity] += 1;
  }
  return { totalItems: findings.length, byType, bySeverity, comparedLocal, comparedRemote };
}
