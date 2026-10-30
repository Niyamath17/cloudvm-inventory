/**
 * VM identity – the ONLY place a VirtualMachine.externalId is built.
 *
 * Rule: externalId = "<scope>/.../<native provider id>", where the scope makes
 * the native ID unique even if the provider only guarantees uniqueness inside
 * an account/project/cluster/vCenter. Together with the database constraint
 * @@unique([provider, externalId]) this prevents duplicate VM rows and prevents
 * two different VMs from colliding.
 *
 *   Provider  externalId                              Why this scope
 *   AWS       <accountId>/<region>/<instanceId>       AWS does not document instance IDs as globally unique, so scope by account+region
 *   AZURE     <subscriptionId>/<vmId>                 vmId (GUID) survives renames/resource-group moves; subscription scopes it
 *   GCP       <projectId>/<instanceId>                numeric instance id is unique within a project
 *   PROXMOX   <clusterName>/<vmid>                    VMIDs restart at 100 in every cluster
 *   VMWARE    <vCenter host>/<instanceUuid>           instance UUID is unique per vCenter; morefs (vm-1001) are not stable enough
 *
 * Inputs are validated: an empty or "/"-containing part would make the key
 * ambiguous, so it is rejected instead of silently producing a bad identity.
 */
export type ProviderName = 'AWS' | 'AZURE' | 'GCP' | 'PROXMOX' | 'VMWARE';

export interface VmIdentity {
  provider: ProviderName;
  /** Fully scoped, stable key (unique per provider). */
  externalId: string;
  /** Provider's own unscoped ID, for display/search. */
  nativeId: string;
  /** Top-level scope: AWS account, Azure subscription, GCP project, Proxmox cluster, vCenter host. */
  account: string;
}

export class IdentityError extends Error {}

function part(label: string, value: string | number | undefined | null): string {
  const v = value === undefined || value === null ? '' : String(value).trim();
  if (v === '') throw new IdentityError(`${label} is required to build a VM identity`);
  if (v.includes('/')) throw new IdentityError(`${label} must not contain "/" (got "${v}")`);
  return v;
}

export const buildIdentity = {
  aws(accountId: string, region: string, instanceId: string): VmIdentity {
    const [a, r, i] = [part('AWS accountId', accountId), part('AWS region', region), part('AWS instanceId', instanceId)];
    return { provider: 'AWS', externalId: `${a}/${r}/${i}`, nativeId: i, account: a };
  },

  azure(subscriptionId: string, vmId: string): VmIdentity {
    // GUIDs are case-insensitive; normalise so "ABC" and "abc" are the same VM.
    const s = part('Azure subscriptionId', subscriptionId).toLowerCase();
    const v = part('Azure vmId', vmId).toLowerCase();
    return { provider: 'AZURE', externalId: `${s}/${v}`, nativeId: v, account: s };
  },

  gcp(projectId: string, instanceId: string): VmIdentity {
    const [p, i] = [part('GCP projectId', projectId), part('GCP instanceId', instanceId)];
    return { provider: 'GCP', externalId: `${p}/${i}`, nativeId: i, account: p };
  },

  proxmox(clusterName: string, vmid: number | string): VmIdentity {
    const [c, v] = [part('Proxmox cluster', clusterName), part('Proxmox vmid', vmid)];
    return { provider: 'PROXMOX', externalId: `${c}/${v}`, nativeId: v, account: c };
  },

  vmware(vcenterHost: string, instanceUuid: string): VmIdentity {
    const h = part('vCenter host', vcenterHost).toLowerCase(); // hostnames are case-insensitive
    const u = part('VMware instance_uuid', instanceUuid).toLowerCase();
    return { provider: 'VMWARE', externalId: `${h}/${u}`, nativeId: u, account: h };
  },
};

/** Value CloudVM writes to NetBox's built-in `serial` field to find its records again (M4). */
export function netboxSerial(identity: Pick<VmIdentity, 'provider' | 'externalId'>): string {
  return `${identity.provider.toLowerCase()}:${identity.externalId}`;
}
