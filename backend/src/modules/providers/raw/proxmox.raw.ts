/**
 * Raw Proxmox VE shapes (subset of GET /cluster/resources?type=vm, per cluster,
 * plus QEMU guest-agent results). maxmem/maxdisk are BYTES; tags are one ';'-separated string.
 */
import { z } from 'zod';
import { mockMetaSchema } from './meta.js';

export const proxmoxResourceSchema = z.looseObject({
  id: z.string(), // "qemu/101" | "lxc/210"
  vmid: z.number().int().positive(),
  name: z.string(),
  node: z.string(),
  type: z.enum(['qemu', 'lxc']),
  status: z.string(), // "running" | "stopped" | "unknown" (offline node) ...
  maxcpu: z.number().nonnegative(),
  maxmem: z.number().int().nonnegative(),
  maxdisk: z.number().int().nonnegative(),
  tags: z.string().optional(),
  template: z.union([z.literal(0), z.literal(1)]).default(0),
  ostype: z.string().optional(),
});

export const proxmoxAgentSchema = z.object({
  hostname: z.string().optional(),
  ipAddresses: z.array(z.string()).default([]),
});

export const proxmoxClusterSchema = z.object({
  cluster: z.string(),
  error: z.string().optional(), // MOCK simulation of a failed cluster query
  data: z.array(proxmoxResourceSchema),
  agent: z.record(z.string(), proxmoxAgentSchema).default({}), // keyed by vmid
});

export const proxmoxSampleSchema = z.object({
  _meta: mockMetaSchema.extend({ provider: z.literal('PROXMOX') }),
  clusters: z.array(proxmoxClusterSchema),
});

export type ProxmoxResource = z.infer<typeof proxmoxResourceSchema>;
export type ProxmoxSample = z.infer<typeof proxmoxSampleSchema>;
