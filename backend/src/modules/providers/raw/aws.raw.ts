/**
 * Raw AWS EC2 shapes (subset of DescribeInstances / DescribeInstanceTypes /
 * DescribeVolumes). Field names match the AWS API so a future LIVE adapter using
 * @aws-sdk/client-ec2 can feed the same normalizer.
 *
 * z.looseObject keeps unknown fields: we validate what we rely on and preserve
 * the rest for VirtualMachine.rawData.
 */
import { z } from 'zod';
import { mockMetaSchema, queriedAccountsSchema } from './meta.js';

export const awsTagSchema = z.object({ Key: z.string(), Value: z.string() });

export const awsInstanceSchema = z.looseObject({
  InstanceId: z.string().regex(/^i-[0-9a-f]+$/),
  InstanceType: z.string(),
  State: z.object({ Code: z.number().int(), Name: z.string() }),
  Placement: z.looseObject({ AvailabilityZone: z.string() }),
  PrivateDnsName: z.string().optional(),
  PrivateIpAddress: z.string().optional(),
  PublicIpAddress: z.string().optional(),
  PlatformDetails: z.string().optional(),
  LaunchTime: z.string().optional(),
  BlockDeviceMappings: z
    .array(z.looseObject({ DeviceName: z.string(), Ebs: z.looseObject({ VolumeId: z.string() }).optional() }))
    .default([]),
  Tags: z.array(awsTagSchema).default([]),
});

export const awsInstanceTypeSchema = z.looseObject({
  InstanceType: z.string(),
  VCpuInfo: z.object({ DefaultVCpus: z.number().int().positive() }),
  MemoryInfo: z.object({ SizeInMiB: z.number().int().positive() }),
});

export const awsVolumeSchema = z.looseObject({
  VolumeId: z.string(),
  Size: z.number().int().nonnegative(), // GiB
});

export const awsSampleSchema = z.object({
  _meta: mockMetaSchema.extend({ provider: z.literal('AWS') }),
  accounts: queriedAccountsSchema,
  Reservations: z.array(z.looseObject({ Instances: z.array(awsInstanceSchema) })),
  InstanceTypes: z.array(awsInstanceTypeSchema),
  Volumes: z.array(awsVolumeSchema),
});

export type AwsInstance = z.infer<typeof awsInstanceSchema>;
export type AwsSample = z.infer<typeof awsSampleSchema>;
