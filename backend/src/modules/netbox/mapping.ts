/**
 * VirtualMachine (DB row) -> NetBox payload, and payload diffing. Pure functions.
 *
 * Only NetBox's built-in VM fields are used – no custom fields are assumed:
 *   serial  = "<provider>:<externalId>" (matching key)       cluster = "<PROVIDER>/<cluster|region|account>"
 *   vcpus   = cpuCores        memory = memoryMb (MiB)        disk = diskGb × 1024 (NetBox ≥ 4.1 stores MB)
 *   status  = decommissioning | active | offline; UNKNOWN power is NOT sent
 *   tags    = cloudvm-managed, cloudvm-mock (data is MOCK)    comments = read-only facts (owner, OS, IPs, …)
 */
import type { VirtualMachine } from '@prisma/client';
import { netboxSerial } from '../../domain/identity.js';
import type { ClusterSpec, NbVm, NbVmWrite } from './NetBoxGateway.js';

export const MANAGED_TAG = 'cloudvm-managed';
export const MOCK_TAG = 'cloudvm-mock';
export const DESCRIPTION = 'Managed by CloudVM – MOCK provider data';

type VmRow = Pick<
  VirtualMachine,
  'provider' | 'externalId' | 'nativeId' | 'account' | 'name' | 'hostname' | 'ipAddresses' | 'osName' | 'cpuCores'
  | 'memoryMb' | 'diskGb' | 'region' | 'cluster' | 'owner' | 'powerState' | 'lifecycle' | 'dataSource'
>;

export function clusterFor(vm: Pick<VmRow, 'provider' | 'cluster' | 'region' | 'account'>): ClusterSpec {
  return { name: `${vm.provider}/${vm.cluster ?? vm.region ?? vm.account}`, provider: vm.provider };
}

export function statusFor(vm: Pick<VmRow, 'lifecycle' | 'powerState'>): string | undefined {
  if (vm.lifecycle === 'DECOMMISSIONED') return 'decommissioning';
  switch (vm.powerState) {
    case 'RUNNING':
      return 'active';
    case 'STOPPED':
    case 'SUSPENDED':
      return 'offline';
    default:
      return undefined; // UNKNOWN: don't overwrite NetBox with a guess
  }
}

/** Name used when the plain name is already taken in the cluster by a different VM. */
export const disambiguatedName = (vm: Pick<VmRow, 'name' | 'nativeId'>): string => `${vm.name} (${vm.nativeId.slice(0, 8)})`;

export function toNetBoxWrite(vm: VmRow): NbVmWrite {
  const facts = [
    `CloudVM (${vm.dataSource} data) · ${vm.provider} · account ${vm.account}`,
    vm.owner ? `owner: ${vm.owner}` : null,
    vm.osName ? `os: ${vm.osName}` : null,
    vm.hostname ? `hostname: ${vm.hostname}` : null,
    vm.ipAddresses.length ? `ips: ${vm.ipAddresses.join(', ')}` : null,
    vm.region ? `region: ${vm.region}` : null,
  ].filter(Boolean);
  const write: NbVmWrite = {
    name: vm.name,
    serial: netboxSerial(vm),
    cluster: clusterFor(vm).name,
    vcpus: vm.cpuCores,
    memory: vm.memoryMb,
    disk: vm.diskGb === null ? null : vm.diskGb * 1024,
    description: DESCRIPTION,
    comments: facts.join('\n'),
    tags: [MANAGED_TAG, MOCK_TAG],
  };
  const status = statusFor(vm);
  if (status) write.status = status;
  return write;
}

export type FieldDiff = Record<string, { from: unknown; to: unknown }>;

/**
 * Fields of `desired` that differ from `remote`. The disambiguated form of our name counts as
 * equal, so a VM created as "app-server (50000003)" is not renamed back every run.
 */
export function diffWrite(
  desired: NbVmWrite,
  remote: NbVm,
  vm: Pick<VmRow, 'name' | 'nativeId'>,
  unsupported: ReadonlyArray<keyof NbVmWrite> = [],
): { patch: Partial<NbVmWrite>; diff: FieldDiff } {
  const patch: Partial<NbVmWrite> = {};
  const diff: FieldDiff = {};
  const set = <K extends keyof NbVmWrite>(key: K, from: unknown) => {
    if (unsupported.includes(key)) return;
    patch[key] = desired[key];
    diff[key] = { from, to: desired[key] };
  };
  if (remote.name !== desired.name && remote.name !== disambiguatedName(vm)) set('name', remote.name);
  if (remote.serial !== desired.serial) set('serial', remote.serial);
  if (remote.cluster !== desired.cluster) set('cluster', remote.cluster);
  if (desired.status !== undefined && remote.status !== desired.status) set('status', remote.status);
  if (remote.vcpus !== desired.vcpus) set('vcpus', remote.vcpus);
  if (remote.memory !== desired.memory) set('memory', remote.memory);
  if (remote.disk !== desired.disk) set('disk', remote.disk);
  if (remote.description !== desired.description) set('description', remote.description);
  if (remote.comments !== desired.comments) set('comments', remote.comments);
  if ([...remote.tags].sort().join(',') !== [...desired.tags].sort().join(',')) set('tags', remote.tags);
  return { patch, diff };
}
