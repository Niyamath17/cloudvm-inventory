/**
 * Proxmox VE -> NormalizedVm.
 *
 *   skipped   template = 1  -> "template" (a VM image, not a running VM)
 *             type = lxc    -> "LXC container" (containers are out of scope for this
 *                              prototype; supporting them is a future enhancement)
 *   identity  <cluster>/<vmid>
 *   memory    maxmem BYTES -> MiB (/1024²) ; disk maxdisk BYTES -> GiB (/1024³) ; cpu = maxcpu
 *   hostname  QEMU guest agent; no agent data -> null + warning
 *   IPs       guest agent (IPv6 link-local dropped)
 *   tags      one ";"-separated string -> { tag: "true" }; "owner-<team>" -> owner
 *   os        ostype code (l26, win11, ...) -> readable name
 *   region    none (on-premises) ; cluster = Proxmox cluster name
 */
import { buildIdentity } from '../../../domain/identity.js';
import { mapProviderState } from '../../../domain/state.js';
import type { ProxmoxRawVm } from '../../providers/mock/proxmox.mock-adapter.js';
import { bytesToGb, bytesToMb, cleanIps, positiveInt, text } from '../helpers.js';
import type { MapOutcome } from '../types.js';
import { identityOrInvalid, stateFields } from './common.js';

/** Proxmox "ostype" codes (qm.conf documentation). */
const OS_TYPES: Record<string, string> = {
  l26: 'Linux (kernel 2.6+)',
  l24: 'Linux (kernel 2.4)',
  win11: 'Windows 11 / Server 2022',
  win10: 'Windows 10 / Server 2016/2019',
  win8: 'Windows 8 / Server 2012',
  win7: 'Windows 7 / Server 2008 R2',
  solaris: 'Solaris',
  other: 'Other',
};

const OWNER_TAG = /^owner[-_:=](.+)$/i;

export function mapProxmoxVm(raw: ProxmoxRawVm): MapOutcome {
  const { resource: r, cluster, agent } = raw;
  const ref = `${cluster}/${r.vmid} (${r.name})`;

  if (r.template === 1) return { kind: 'skipped', ref, reason: 'Proxmox template (VM image, not a VM)' };
  if (r.type === 'lxc') return { kind: 'skipped', ref, reason: 'LXC container (containers are out of scope)' };

  const warnings: string[] = [];
  const id = identityOrInvalid(ref, () => buildIdentity.proxmox(cluster, r.vmid));
  if (!id.ok) return id.outcome;

  // Tags: "prod;web;owner-web-team" -> { prod: "true", web: "true" }, owner "web-team"
  const tags: Record<string, string> = {};
  let owner: string | null = null;
  for (const tag of (r.tags ?? '').split(/[;,]/).map((t) => t.trim()).filter(Boolean)) {
    const ownerMatch = OWNER_TAG.exec(tag);
    if (ownerMatch?.[1]) owner = ownerMatch[1];
    else tags[tag] = 'true';
  }
  if (owner) tags.owner = owner;

  const hostname = text(agent?.hostname);
  if (!hostname) warnings.push('hostname unknown (no QEMU guest agent data)');

  const { ips, dropped } = cleanIps(agent?.ipAddresses ?? []);
  if (dropped.length) warnings.push(`ignored link-local/invalid IPs: ${dropped.join(', ')}`);

  if (!r.ostype) warnings.push('OS unknown (no ostype)');

  return {
    kind: 'vm',
    warnings,
    vm: {
      ...id.identity,
      name: r.name,
      hostname,
      ipAddresses: ips,
      osName: r.ostype ? (OS_TYPES[r.ostype] ?? r.ostype) : null,
      cpuCores: positiveInt(r.maxcpu),
      memoryMb: bytesToMb(r.maxmem), // bytes -> MiB
      diskGb: bytesToGb(r.maxdisk), // bytes -> GiB
      region: null,
      cluster,
      owner,
      tags,
      ...stateFields(mapProviderState('PROXMOX', r.status)),
      rawData: raw,
    },
  };
}
