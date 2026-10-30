import { describe, expect, it } from 'vitest';
import { bytesToGb, bytesToMb, cleanIps, findOwner, positiveInt, sumGb, toNumber } from '../../../src/modules/normalization/helpers.js';

describe('unit conversion', () => {
  it('bytes -> MB (MiB) and GB (GiB)', () => {
    expect(bytesToMb(2 * 1024 ** 3)).toBe(2048);
    expect(bytesToMb(536870912)).toBe(512);
    expect(bytesToGb(32 * 1024 ** 3)).toBe(32);
    expect(bytesToGb(0)).toBe(0);
  });

  it('returns null instead of inventing values', () => {
    expect(bytesToMb(0)).toBeNull();
    expect(bytesToMb(-5)).toBeNull();
    expect(bytesToMb(undefined)).toBeNull();
    expect(bytesToGb(Number.NaN)).toBeNull();
    expect(positiveInt('abc')).toBeNull();
    expect(positiveInt(0)).toBeNull();
  });

  it('accepts numeric strings (GCP int64)', () => {
    expect(toNumber('200')).toBe(200);
    expect(sumGb(['200', '1000'])).toBe(1200);
    expect(sumGb([])).toBeNull();
    expect(sumGb(['x', 50])).toBe(50);
  });
});

describe('cleanIps', () => {
  it('drops invalid and IPv6 link-local, de-duplicates, keeps order', () => {
    expect(cleanIps(['10.0.0.1', ' 10.0.0.1 ', 'not-an-ip', 'fe80::be24:11ff:fe2a:1', '2001:db8::1', undefined, ''])).toEqual({
      ips: ['10.0.0.1', '2001:db8::1'],
      dropped: ['not-an-ip', 'fe80::be24:11ff:fe2a:1'],
    });
  });
});

describe('findOwner', () => {
  it('handles Owner / owner / CreatedBy / created-by / team', () => {
    expect(findOwner({ Owner: 'web-team' })).toBe('web-team');
    expect(findOwner({ owner: 'devops' })).toBe('devops');
    expect(findOwner({ CreatedBy: 'data-eng' })).toBe('data-eng');
    expect(findOwner({ 'created-by': 'x' })).toBe('x');
    expect(findOwner({ team: 'sre' })).toBe('sre');
  });

  it('prefers owner over createdBy and ignores empty values', () => {
    expect(findOwner({ CreatedBy: 'b', owner: 'a' })).toBe('a');
    expect(findOwner({ owner: '  ', CreatedBy: 'b' })).toBe('b');
    expect(findOwner({ env: 'prod' })).toBeNull();
  });
});
