/**
 * Raw Google Compute Engine shapes (subset of instances.aggregatedList + machine types).
 * Note: GCP serialises int64 values (id, diskSizeGb) as strings.
 */
import { z } from 'zod';
import { mockMetaSchema } from './meta.js';

export const gcpInstanceSchema = z.looseObject({
  id: z.string().regex(/^\d+$/),
  name: z.string(),
  zone: z.url(),
  machineType: z.url(),
  status: z.enum(['PROVISIONING', 'STAGING', 'RUNNING', 'STOPPING', 'STOPPED', 'SUSPENDING', 'SUSPENDED', 'REPAIRING', 'TERMINATED']),
  hostname: z.string().optional(),
  networkInterfaces: z
    .array(z.looseObject({ networkIP: z.string().optional(), accessConfigs: z.array(z.looseObject({ natIP: z.string().optional() })).optional() }))
    .default([]),
  disks: z
    .array(z.looseObject({ boot: z.boolean().optional(), diskSizeGb: z.string().regex(/^\d+$/), licenses: z.array(z.string()).optional() }))
    .default([]),
  labels: z.record(z.string(), z.string()).default({}),
});

export const gcpMachineTypeSchema = z.object({
  name: z.string(),
  guestCpus: z.number().int().positive(),
  memoryMb: z.number().int().positive(),
});

export const gcpSampleSchema = z.object({
  _meta: mockMetaSchema.extend({ provider: z.literal('GCP') }),
  items: z.record(z.string(), z.object({ instances: z.array(gcpInstanceSchema).default([]) })),
  machineTypes: z.array(gcpMachineTypeSchema),
});

export type GcpInstance = z.infer<typeof gcpInstanceSchema>;
export type GcpSample = z.infer<typeof gcpSampleSchema>;
