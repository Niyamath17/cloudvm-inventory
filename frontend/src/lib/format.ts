/** Display formatting. Memory is stored in MiB and disk in GiB (backend binary convention). */
export function formatMemory(mib: number | null | undefined): string {
  if (mib === null || mib === undefined) return '—';
  if (mib >= 1024) {
    const gib = mib / 1024;
    return `${Number.isInteger(gib) ? gib : gib.toFixed(1)} GiB`;
  }
  return `${mib} MiB`;
}

export function formatDisk(gib: number | null | undefined): string {
  if (gib === null || gib === undefined) return '—';
  if (gib >= 1024) return `${(gib / 1024).toFixed(gib % 1024 === 0 ? 0 : 1)} TiB`;
  return `${gib} GiB`;
}

export const formatNumber = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-IN'));

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function duration(startIso: string, endIso: string | null): string {
  if (!endIso) return 'running…';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export const PROVIDER_LABEL: Record<string, string> = { AWS: 'AWS', AZURE: 'Azure', GCP: 'Google Cloud', PROXMOX: 'Proxmox', VMWARE: 'VMware' };
export const PROVIDER_COLOR: Record<string, string> = { AWS: '#f59e0b', AZURE: '#3b82f6', GCP: '#10b981', PROXMOX: '#f97316', VMWARE: '#8b5cf6' };
export const DRIFT_LABEL: Record<string, string> = {
  MISSING_IN_NETBOX: 'Missing in NetBox',
  ORPHAN_IN_NETBOX: 'Orphan in NetBox',
  RESOURCE_MISMATCH: 'Resource mismatch',
  POWER_STATE_MISMATCH: 'Power-state mismatch',
  DUPLICATE: 'Duplicate records',
};
