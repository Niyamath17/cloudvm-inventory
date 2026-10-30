/**
 * Raw VMware vSphere Automation REST shapes (subset of /api/vcenter/vm list +
 * detail + guest identity, with cluster placement and tag assignments).
 * Memory in MiB, disk capacity in BYTES.
 */
import { z } from 'zod';
import { mockMetaSchema } from './meta.js';

export const vmwareVmSchema = z.object({
  summary: z.looseObject({
    vm: z.string(), // moref, e.g. "vm-1001" – unique per vCenter only
    name: z.string(),
    power_state: z.enum(['POWERED_ON', 'POWERED_OFF', 'SUSPENDED']),
    cpu_count: z.number().int().positive().optional(),
    memory_size_MiB: z.number().int().positive().optional(),
  }),
  detail: z.looseObject({
    identity: z.looseObject({ instance_uuid: z.string(), name: z.string() }),
    guest_OS: z.string().optional(),
    disks: z.record(z.string(), z.looseObject({ capacity: z.number().int().nonnegative().optional() })).default({}),
  }),
  guestIdentity: z
    .object({
      host_name: z.string().optional(),
      ip_address: z.string().optional(),
      full_name: z.object({ default_message: z.string() }).optional(),
    })
    .nullable(), // null: VM off or VMware Tools not running
  placement: z.object({ cluster: z.string().optional() }),
  tags: z.array(z.object({ category: z.string(), name: z.string() })).default([]),
});

export const vmwareSampleSchema = z.object({
  _meta: mockMetaSchema.extend({ provider: z.literal('VMWARE') }),
  vcenter: z.string().min(1), // vCenter host – scopes instance_uuid in the VM identity
  vms: z.array(vmwareVmSchema),
});

export type VmwareVm = z.infer<typeof vmwareVmSchema>;
export type VmwareSample = z.infer<typeof vmwareSampleSchema>;
