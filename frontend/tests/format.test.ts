import { describe, expect, it } from 'vitest';
import { duration, formatDisk, formatMemory, formatNumber, timeAgo } from '../src/lib/format';

describe('format helpers (memory = MiB, disk = GiB)', () => {
  it('formats memory', () => {
    expect(formatMemory(512)).toBe('512 MiB');
    expect(formatMemory(4096)).toBe('4 GiB');
    expect(formatMemory(1536)).toBe('1.5 GiB');
    expect(formatMemory(null)).toBe('—');
  });
  it('formats disk', () => {
    expect(formatDisk(100)).toBe('100 GiB');
    expect(formatDisk(2048)).toBe('2 TiB');
    expect(formatDisk(1536)).toBe('1.5 TiB');
    expect(formatDisk(undefined)).toBe('—');
  });
  it('formats numbers and missing values', () => {
    expect(formatNumber(58)).toBe('58');
    expect(formatNumber(null)).toBe('—');
  });
  it('formats relative time and durations', () => {
    const now = Date.parse('2026-10-31T10:00:00Z');
    expect(timeAgo('2026-10-31T09:59:30Z', now)).toBe('30s ago');
    expect(timeAgo('2026-10-31T09:15:00Z', now)).toBe('45m ago');
    expect(timeAgo('2026-10-31T07:00:00Z', now)).toBe('3h ago');
    expect(timeAgo(null, now)).toBe('never');
    expect(duration('2026-10-31T10:00:00Z', '2026-10-31T10:00:00.250Z')).toBe('250 ms');
    expect(duration('2026-10-31T10:00:00Z', '2026-10-31T10:00:02.5Z')).toBe('2.5 s');
    expect(duration('2026-10-31T10:00:00Z', null)).toBe('running…');
  });
});
