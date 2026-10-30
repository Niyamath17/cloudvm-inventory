/**
 * VMware vSphere -> NormalizedVm.
 *
 *   identity  <vCenter host>/<instance_uuid>   (morefs like vm-1001 are only per-vCenter)
 *   hostname  guest identity host_name – needs VMware Tools; powered off / no Tools -> null + warning
 *   IPs       guest identity ip_address
 *   os        guest identity full name, else the configured guest_OS id (e.g. "RHEL_8_64")
 *   memory    memory_size_MiB (as is) ; cpu = cpu_count ; disk = sum of capacities BYTES -> GiB
 *   tags      [{category, name}] -> { category: name } (several tags in one category joined with ", ")
 *   owner     tag category "Owner"
 *   region    none (on-premises) ; cluster = placement cluster
 */
import { buildIdentity } from '../../../domain/identity.js';
import { mapProviderState } from '../../../domain/state.js';
import type { VmwareRawVm } from '../../providers/mock/vmware.mock-adapter.js';
import { bytesToGb, cleanIps, findOwner, positiveInt, text } from '../helpers.js';
import type { MapOutcome } from '../types.js';
import { identityOrInvalid, stateFields } from './common.js';

export function mapVmwareVm(raw: VmwareRawVm): MapOutcome {
  const { vm, vcenter } = raw;
  const { summary, detail, guestIdentity } = vm;
  const warnings: string[] = [];

  const id = identityOrInvalid(summary.name, () => buildIdentity.vmware(vcenter, detail.identity.instance_uuid));
  if (!id.ok) return id.outcome;

  const hostname = text(guestIdentity?.host_name);
  if (!hostname) warnings.push('hostname unknown (VM powered off or VMware Tools not running)');

  const { ips, dropped } = cleanIps([guestIdentity?.ip_address]);
  if (dropped.length) warnings.push(`ignored invalid IPs: ${dropped.join(', ')}`);

  const tags: Record<string, string> = {};
  for (const t of vm.tags) tags[t.category] = tags[t.category] ? `${tags[t.category]}, ${t.name}` : t.name;

  const capacities = Object.values(detail.disks).map((d) => d.capacity);
  const knownBytes = capacities.filter((c): c is number => typeof c === 'number');
  if (knownBytes.length < capacities.length) warnings.push('some disks report no capacity');

  return {
    kind: 'vm',
    warnings,
    vm: {
      ...id.identity,
      name: summary.name,
      hostname,
      ipAddresses: ips,
      osName: text(guestIdentity?.full_name?.default_message) ?? text(detail.guest_OS),
      cpuCores: positiveInt(summary.cpu_count),
      memoryMb: positiveInt(summary.memory_size_MiB), // MiB, as is
      diskGb: knownBytes.length ? bytesToGb(knownBytes.reduce((a, b) => a + b, 0)) : null,
      region: null,
      cluster: text(vm.placement.cluster),
      owner: findOwner(tags),
      tags,
      ...stateFields(mapProviderState('VMWARE', summary.power_state)),
      rawData: raw,
    },
  };
}
