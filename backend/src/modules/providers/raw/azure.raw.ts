/**
 * Raw Azure Resource Manager shapes (subset of "Virtual Machines - List All"
 * with instanceView, VM sizes and network interfaces).
 */
import { z } from 'zod';
import { mockMetaSchema } from './meta.js';

export const azureVmSchema = z.looseObject({
  id: z.string().startsWith('/subscriptions/'),
  name: z.string(),
  location: z.string(),
  tags: z.record(z.string(), z.string()).default({}),
  properties: z.looseObject({
    vmId: z.uuid(),
    hardwareProfile: z.object({ vmSize: z.string() }),
    storageProfile: z.looseObject({
      imageReference: z.looseObject({ publisher: z.string(), offer: z.string(), sku: z.string() }).optional(),
      osDisk: z.looseObject({ osType: z.enum(['Linux', 'Windows']), diskSizeGB: z.number().int().optional() }),
      dataDisks: z.array(z.looseObject({ diskSizeGB: z.number().int() })).default([]),
    }),
    osProfile: z.looseObject({ computerName: z.string() }).optional(), // missing => hostname unknown
    networkProfile: z.object({ networkInterfaces: z.array(z.object({ id: z.string() })) }),
    instanceView: z.object({ statuses: z.array(z.looseObject({ code: z.string() })) }).optional(),
  }),
});

export const azureVmSizeSchema = z.object({
  name: z.string(),
  numberOfCores: z.number().int().positive(),
  memoryInMB: z.number().int().positive(),
});

export const azureNicSchema = z.looseObject({
  id: z.string(),
  properties: z.object({
    ipConfigurations: z.array(z.looseObject({ properties: z.looseObject({ privateIPAddress: z.string().optional() }) })),
  }),
});

export const azureSampleSchema = z.object({
  _meta: mockMetaSchema.extend({ provider: z.literal('AZURE') }),
  value: z.array(azureVmSchema),
  vmSizes: z.array(azureVmSizeSchema),
  networkInterfaces: z.array(azureNicSchema),
});

export type AzureVm = z.infer<typeof azureVmSchema>;
export type AzureSample = z.infer<typeof azureSampleSchema>;
