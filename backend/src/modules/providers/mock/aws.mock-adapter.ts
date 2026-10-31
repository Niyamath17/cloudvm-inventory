/**
 * AWS MOCK adapter.
 *
 * ⚠️ MOCK: reads backend/sample-data/aws.ec2.describe-instances.json – NOT the AWS API.
 *
 * A LIVE adapter would call EC2 DescribeInstances (per account, per region),
 * DescribeInstanceTypes and DescribeVolumes with @aws-sdk/client-ec2 and return
 * exactly the same AwsRawVm records, so the mapper stays unchanged.
 */
import { z } from 'zod';
import { awsInstanceSchema, awsInstanceTypeSchema, awsVolumeSchema, type AwsInstance } from '../raw/aws.raw.js';
import type { CollectionBatch, ProviderAdapter, RejectedRawRecord } from '../ProviderAdapter.js';
import { asArray, DEFAULT_SAMPLE_DIR, failedSet, readMockSample, readString, resolveAccounts, validateEach } from './sample-file.js';

export const AWS_SAMPLE_FILE = 'aws.ec2.describe-instances.json';

/** One self-contained AWS VM: the instance plus the lookups the mapper needs. */
export interface AwsRawVm {
  accountId: string;
  instance: AwsInstance;
  instanceType: z.infer<typeof awsInstanceTypeSchema> | null; // DescribeInstanceTypes entry
  volumes: Array<z.infer<typeof awsVolumeSchema>>; // DescribeVolumes entries attached to this instance
}

export class AwsMockAdapter implements ProviderAdapter<AwsRawVm> {
  readonly provider = 'AWS' as const;
  readonly dataSource = 'MOCK' as const;

  constructor(private readonly sampleDir: string = DEFAULT_SAMPLE_DIR) {}

  async collect(): Promise<CollectionBatch<AwsRawVm>> {
    const file = await readMockSample(this.sampleDir, AWS_SAMPLE_FILE, 'AWS');

    // Lookups: a malformed lookup entry is simply unusable (the mapper then warns "unknown type").
    const types = validateEach(asArray(file.InstanceTypes), awsInstanceTypeSchema, () => null).valid;
    const volumes = validateEach(asArray(file.Volumes), awsVolumeSchema, () => null).valid;
    const typeByName = new Map(types.map((t) => [t.InstanceType, t]));
    const volumeById = new Map(volumes.map((v) => [v.VolumeId, v]));

    const records: AwsRawVm[] = [];
    const rejected: RejectedRawRecord[] = [];
    const seenAccounts = new Set<string>();

    for (const reservation of asArray(file.Reservations)) {
      const accountId = readString(reservation, 'OwnerId');
      const instances = asArray((reservation as { Instances?: unknown })?.Instances);
      const ref = (i: unknown) => readString(i, 'InstanceId');

      if (!accountId) {
        // Without the owning account there is no stable identity – reject, don't guess.
        rejected.push(...instances.map((i) => ({ ref: ref(i), errors: ['reservation has no OwnerId (AWS account)'] })));
        continue;
      }
      seenAccounts.add(accountId);
      const { valid, rejected: bad } = validateEach(instances, awsInstanceSchema, ref);
      rejected.push(...bad.map((b) => ({ ...b, account: accountId })));
      for (const instance of valid) {
        records.push({
          accountId,
          instance,
          instanceType: typeByName.get(instance.InstanceType) ?? null,
          volumes: instance.BlockDeviceMappings.flatMap((m) => {
            const v = m.Ebs ? volumeById.get(m.Ebs.VolumeId) : undefined;
            return v ? [v] : [];
          }),
        });
      }
    }

    // Accounts queried (declared in the MOCK file, like an adapter's configuration).
    const accounts = resolveAccounts(file.accounts, seenAccounts);
    const failed = failedSet(accounts);

    return {
      provider: 'AWS',
      dataSource: 'MOCK',
      sourceLabel: `MOCK sample file ${AWS_SAMPLE_FILE}`,
      collectedAt: new Date(),
      records: records.filter((r) => !failed.has(r.accountId)),
      rejected: rejected.filter((r) => !r.account || !failed.has(r.account)),
      accounts,
    };
  }
}
