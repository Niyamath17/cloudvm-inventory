/**
 * Raw (provider-shaped) schemas and the sample file each one validates.
 * M2 adapters import from here; M1 tests use it to validate the MOCK sample data.
 */
import { awsSampleSchema } from './aws.raw.js';
import { azureSampleSchema } from './azure.raw.js';
import { gcpSampleSchema } from './gcp.raw.js';
import { proxmoxSampleSchema } from './proxmox.raw.js';
import { vmwareSampleSchema } from './vmware.raw.js';

export const sampleFiles = {
  AWS: { file: 'aws.ec2.describe-instances.json', schema: awsSampleSchema },
  AZURE: { file: 'azure.compute.virtual-machines.json', schema: azureSampleSchema },
  GCP: { file: 'gcp.compute.instances-aggregated.json', schema: gcpSampleSchema },
  PROXMOX: { file: 'proxmox.cluster-resources.json', schema: proxmoxSampleSchema },
  VMWARE: { file: 'vmware.vcenter-vms.json', schema: vmwareSampleSchema },
} as const;

export * from './aws.raw.js';
export * from './azure.raw.js';
export * from './gcp.raw.js';
export * from './proxmox.raw.js';
export * from './vmware.raw.js';
export * from './meta.js';
