/**
 * AWS EC2 -> NormalizedVm.
 *
 *   identity  <OwnerId>/<region>/<InstanceId>   region = AZ minus its letter (ap-south-1a -> ap-south-1)
 *   name      "Name" tag, else the instance ID (warning)
 *   hostname  PrivateDnsName ("" for terminated instances -> null)
 *   memory    DescribeInstanceTypes MemoryInfo.SizeInMiB (already MB/MiB)
 *   cpu       DescribeInstanceTypes VCpuInfo.DefaultVCpus
 *   disk      sum of attached EBS volume sizes (GiB)
 *   state     shutting-down/terminated -> DECOMMISSIONED (PROVIDER_TERMINATED), see domain/state.ts
 *   cluster   availability zone
 */
import { buildIdentity } from '../../../domain/identity.js';
import { mapProviderState } from '../../../domain/state.js';
import type { AwsRawVm } from '../../providers/mock/aws.mock-adapter.js';
import { cleanIps, findOwner, positiveInt, sumGb, text } from '../helpers.js';
import type { MapOutcome } from '../types.js';
import { identityOrInvalid, stateFields } from './common.js';

const AZ_PATTERN = /^([a-z]{2}(?:-[a-z]+)+-\d+)[a-z]$/;

export function mapAwsVm(raw: AwsRawVm): MapOutcome {
  const { instance: i } = raw;
  const warnings: string[] = [];

  const az = i.Placement.AvailabilityZone;
  const region = AZ_PATTERN.exec(az)?.[1];
  if (!region) return { kind: 'invalid', ref: i.InstanceId, errors: [`cannot derive region from availability zone "${az}"`] };

  const id = identityOrInvalid(i.InstanceId, () => buildIdentity.aws(raw.accountId, region, i.InstanceId));
  if (!id.ok) return id.outcome;

  // Tags: AWS returns [{Key, Value}]; "Name" becomes the VM name, the rest stay tags.
  const tags: Record<string, string> = {};
  let name: string | null = null;
  for (const t of i.Tags) {
    if (t.Key === 'Name') name = text(t.Value);
    else tags[t.Key] = t.Value;
  }
  if (!name) {
    name = i.InstanceId;
    warnings.push('no Name tag – using the instance ID as name');
  }

  const state = mapProviderState('AWS', i.State.Name);
  const active = state.lifecycle === 'ACTIVE';

  const hostname = text(i.PrivateDnsName);
  if (!hostname && active) warnings.push('hostname unknown (no PrivateDnsName)');

  const { ips, dropped } = cleanIps([i.PrivateIpAddress, i.PublicIpAddress]);
  if (dropped.length) warnings.push(`ignored invalid IPs: ${dropped.join(', ')}`);

  if (!raw.instanceType) warnings.push(`instance type "${i.InstanceType}" not found – CPU and memory unknown`);

  const attachedIds = i.BlockDeviceMappings.flatMap((m) => (m.Ebs ? [m.Ebs.VolumeId] : []));
  if (attachedIds.length > raw.volumes.length) warnings.push('some attached volumes were not found – disk size may be understated');

  return {
    kind: 'vm',
    warnings,
    vm: {
      ...id.identity,
      name,
      hostname,
      ipAddresses: ips,
      osName: text(i.PlatformDetails),
      cpuCores: positiveInt(raw.instanceType?.VCpuInfo.DefaultVCpus),
      memoryMb: positiveInt(raw.instanceType?.MemoryInfo.SizeInMiB),
      diskGb: sumGb(raw.volumes.map((v) => v.Size)),
      region,
      cluster: az,
      owner: findOwner(tags),
      tags,
      ...stateFields(state),
      rawData: raw,
    },
  };
}
