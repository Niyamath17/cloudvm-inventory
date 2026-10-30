/**
 * GCP Compute Engine -> NormalizedVm.
 *
 *   identity  <projectId>/<instanceId>   project parsed from the zone URL
 *   region    zone minus its letter suffix (asia-south1-a -> asia-south1); cluster = zone
 *   hostname  "hostname" field – only present when a custom hostname was set; else null + warning
 *   memory    machine type memoryMb (binary MiB, as is); custom types decoded from the name
 *             ("custom-6-23040" = 6 vCPU / 23040 MiB)
 *   disk      sum of diskSizeGb (int64 serialised as STRING by GCP)
 *   os        last segment of the boot disk's license URL (e.g. "ubuntu-2204-lts")
 *   power     status; GCP "TERMINATED" means STOPPED (see domain/state.ts)
 */
import { buildIdentity } from '../../../domain/identity.js';
import { mapProviderState } from '../../../domain/state.js';
import { lastSegment, type GcpRawVm } from '../../providers/mock/gcp.mock-adapter.js';
import { cleanIps, findOwner, positiveInt, sumGb } from '../helpers.js';
import type { MapOutcome } from '../types.js';
import { identityOrInvalid, stateFields } from './common.js';

const ZONE_URL = /\/projects\/([^/]+)\/zones\/([^/]+)$/;
const CUSTOM_TYPE = /(?:^|-)custom-(\d+)-(\d+)(?:-ext)?$/;

export function mapGcpVm(raw: GcpRawVm): MapOutcome {
  const { instance: i } = raw;
  const warnings: string[] = [];

  const zoneMatch = ZONE_URL.exec(i.zone);
  if (!zoneMatch?.[1] || !zoneMatch[2]) return { kind: 'invalid', ref: i.name, errors: [`cannot parse project/zone from "${i.zone}"`] };
  const [, projectId, zone] = zoneMatch;
  const region = zone.replace(/-[a-z]$/, '');

  const id = identityOrInvalid(i.name, () => buildIdentity.gcp(projectId, i.id));
  if (!id.ok) return id.outcome;

  // CPU / memory: predefined type from the lookup, else decode a custom type name.
  let cpuCores = positiveInt(raw.machineType?.guestCpus);
  let memoryMb = positiveInt(raw.machineType?.memoryMb);
  if (!raw.machineType) {
    const custom = CUSTOM_TYPE.exec(lastSegment(i.machineType));
    if (custom) {
      cpuCores = positiveInt(custom[1]);
      memoryMb = positiveInt(custom[2]);
    } else {
      warnings.push(`machine type "${lastSegment(i.machineType)}" not found – CPU and memory unknown`);
    }
  }

  const hostname = i.hostname?.trim() || null;
  if (!hostname) warnings.push('hostname unknown (no custom hostname set on the instance)');

  const { ips, dropped } = cleanIps(i.networkInterfaces.flatMap((n) => [n.networkIP, ...(n.accessConfigs ?? []).map((a) => a.natIP)]));
  if (dropped.length) warnings.push(`ignored invalid IPs: ${dropped.join(', ')}`);

  const bootLicense = i.disks.find((d) => d.boot)?.licenses?.[0];
  if (!bootLicense) warnings.push('OS unknown (no boot disk license)');

  return {
    kind: 'vm',
    warnings,
    vm: {
      ...id.identity,
      name: i.name,
      hostname,
      ipAddresses: ips,
      osName: bootLicense ? lastSegment(bootLicense) : null,
      cpuCores,
      memoryMb,
      diskGb: sumGb(i.disks.map((d) => d.diskSizeGb)),
      region,
      cluster: zone,
      owner: findOwner(i.labels),
      tags: i.labels,
      ...stateFields(mapProviderState('GCP', i.status)),
      rawData: raw,
    },
  };
}
