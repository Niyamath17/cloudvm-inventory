import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('parseEnv', () => {
  it('applies safe defaults (simulation mode, port 4000, scheduler off)', () => {
    const env = parseEnv({ ...base });
    expect(env.NETBOX_MODE).toBe('simulation');
    expect(env.PORT).toBe(4000);
    expect(env.SCHEDULER_ENABLED).toBe(false);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/postgresql/);
  });

  it('requires NETBOX_URL and NETBOX_TOKEN in live mode', () => {
    expect(() => parseEnv({ ...base, NETBOX_MODE: 'live' })).toThrow(/NETBOX_URL[\s\S]*NETBOX_TOKEN/);
  });

  it('accepts live mode when URL and token are provided', () => {
    const env = parseEnv({
      ...base,
      NETBOX_MODE: 'live',
      NETBOX_URL: 'https://netbox.example.com',
      NETBOX_TOKEN: 'abc',
      NETBOX_AUTH_SCHEME: 'Bearer',
    });
    expect(env.NETBOX_MODE).toBe('live');
    expect(env.NETBOX_AUTH_SCHEME).toBe('Bearer');
  });

  it('treats empty optional NetBox values as unset', () => {
    const env = parseEnv({ ...base, NETBOX_URL: '', NETBOX_TOKEN: '' });
    expect(env.NETBOX_URL).toBeUndefined();
    expect(env.NETBOX_TOKEN).toBeUndefined();
  });
});
