/**
 * Small, pure conversion helpers shared by all mappers. Each one returns null
 * (never a made-up value) when the input is missing or nonsensical, and the
 * mapper records a warning.
 */
import { isIP } from 'node:net';

/** Binary units – see the unit convention in domain/normalized-vm.ts. */
export const BYTES_PER_MIB = 1024 * 1024;
export const BYTES_PER_GIB = 1024 * BYTES_PER_MIB;
const MiB = BYTES_PER_MIB;
const GiB = BYTES_PER_GIB;

/** Bytes -> MiB (stored in the `memoryMb` column). Proxmox maxmem. */
export function bytesToMb(bytes: number | null | undefined): number | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return null;
  return Math.round(bytes / MiB);
}

/** Bytes -> GiB (stored in the `diskGb` column). Proxmox maxdisk, VMware disk capacity. */
export function bytesToGb(bytes: number | null | undefined): number | null {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return null;
  return Math.round(bytes / GiB);
}

/** Accepts a number or a numeric string (GCP serialises int64 as strings). */
export function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

/** Positive integer or null (memory/CPU figures). */
export function positiveInt(value: number | string | null | undefined): number | null {
  const n = toNumber(value);
  return n !== null && n > 0 ? Math.round(n) : null;
}

/** Sum of disk sizes in GB; null if no disk size is known at all. */
export function sumGb(sizes: Array<number | string | null | undefined>): number | null {
  const known = sizes.map(toNumber).filter((n): n is number => n !== null && n >= 0);
  return known.length === 0 ? null : Math.round(known.reduce((a, b) => a + b, 0));
}

/**
 * Cleans IP lists: trims, drops invalid strings and IPv6 link-local (fe80::/10,
 * meaningless outside one network segment), removes duplicates, keeps order.
 * Returns the dropped values so the mapper can warn about them.
 */
export function cleanIps(values: Array<string | null | undefined>): { ips: string[]; dropped: string[] } {
  const ips: string[] = [];
  const dropped: string[] = [];
  for (const raw of values) {
    const v = raw?.trim();
    if (!v) continue;
    if (isIP(v) === 0 || /^fe[89ab][0-9a-f]:/i.test(v)) {
      dropped.push(v);
      continue;
    }
    if (!ips.includes(v)) ips.push(v);
  }
  return { ips, dropped };
}

/** Trimmed non-empty string or null. */
export function text(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/**
 * Owner lookup across inconsistent tag conventions:
 *   AWS "Owner" / "owner" / "CreatedBy", Azure "owner" / "Owner", GCP label "owner",
 *   VMware tag category "Owner", Proxmox tag "owner-<team>".
 * Keys are compared case-insensitively, ignoring "-", "_" and spaces, in priority order.
 */
const OWNER_KEYS = ['owner', 'createdby', 'team'];
const canon = (k: string) => k.toLowerCase().replace(/[-_\s]/g, '');

export function findOwner(tags: Record<string, string>): string | null {
  for (const wanted of OWNER_KEYS) {
    for (const [key, value] of Object.entries(tags)) {
      if (canon(key) === wanted && text(value)) return text(value);
    }
  }
  return null;
}

/** Sorted copy of a tag map, so equal tag sets always serialise identically. */
export function sortTags(tags: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(tags).sort(([a], [b]) => a.localeCompare(b)));
}
