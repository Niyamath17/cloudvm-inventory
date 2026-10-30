/**
 * Azure VM -> NormalizedVm.
 *
 *   identity  <subscriptionId>/<vmId>   subscription parsed from the ARM resource ID
 *   hostname  osProfile.computerName (missing -> null + warning)
 *   memory    VM size memoryInMB (binary MiB, as is) ; cpu = numberOfCores
 *   disk      OS disk + data disks (diskSizeGB, GiB)
 *   power     instanceView status "PowerState/<x>"; no instanceView -> UNKNOWN + warning
 *   region    location ; cluster = resource group
 */
import { buildIdentity } from '../../../domain/identity.js';
import { mapProviderState } from '../../../domain/state.js';
import type { AzureRawVm } from '../../providers/mock/azure.mock-adapter.js';
import { cleanIps, findOwner, positiveInt, sumGb, text } from '../helpers.js';
import type { MapOutcome } from '../types.js';
import { identityOrInvalid, stateFields } from './common.js';

// /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{name}
const ARM_ID = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\//i;

export function mapAzureVm(raw: AzureRawVm): MapOutcome {
  const { vm } = raw;
  const p = vm.properties;
  const warnings: string[] = [];

  const arm = ARM_ID.exec(vm.id);
  if (!arm?.[1] || !arm[2]) return { kind: 'invalid', ref: vm.name, errors: [`cannot parse subscription/resource group from id "${vm.id}"`] };
  const [, subscriptionId, resourceGroup] = arm;

  const id = identityOrInvalid(vm.name, () => buildIdentity.azure(subscriptionId, p.vmId));
  if (!id.ok) return id.outcome;

  const powerCode = p.instanceView?.statuses.find((s) => /^PowerState\//i.test(s.code))?.code;
  if (!powerCode) warnings.push('no instanceView power status – power state unknown');
  const state = mapProviderState('AZURE', powerCode);

  const hostname = text(p.osProfile?.computerName);
  if (!hostname) warnings.push('hostname unknown (no osProfile.computerName)');

  if (!raw.size) warnings.push(`VM size "${p.hardwareProfile.vmSize}" not found – CPU and memory unknown`);

  const { ips, dropped } = cleanIps(raw.nics.flatMap((n) => n.properties.ipConfigurations.map((c) => c.properties.privateIPAddress)));
  if (dropped.length) warnings.push(`ignored invalid IPs: ${dropped.join(', ')}`);
  if (raw.nics.length < p.networkProfile.networkInterfaces.length) warnings.push('some network interfaces were not found');

  const img = p.storageProfile.imageReference;
  const osType = p.storageProfile.osDisk.osType;
  const osName = img ? `${osType} (${img.publisher} ${img.offer} ${img.sku})` : osType;

  return {
    kind: 'vm',
    warnings,
    vm: {
      ...id.identity,
      name: vm.name,
      hostname,
      ipAddresses: ips,
      osName,
      cpuCores: positiveInt(raw.size?.numberOfCores),
      memoryMb: positiveInt(raw.size?.memoryInMB), // MiB, as is
      diskGb: sumGb([p.storageProfile.osDisk.diskSizeGB, ...p.storageProfile.dataDisks.map((d) => d.diskSizeGB)]),
      region: vm.location,
      cluster: resourceGroup,
      owner: findOwner(vm.tags),
      tags: vm.tags,
      ...stateFields(state),
      rawData: raw,
    },
  };
}
