import { describe, expect, it } from 'vitest';
import { buildVmOrderBy, buildVmWhere, vmListQuerySchema } from '../../src/modules/inventory/inventory.query.js';

describe('vmListQuerySchema', () => {
  it('applies defaults', () => {
    expect(vmListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 25, lifecycle: 'ALL', sortBy: 'name', sortOrder: 'asc' });
  });

  it('parses comma lists case-insensitively and coerces numbers', () => {
    expect(vmListQuerySchema.parse({ provider: 'aws,Gcp', powerState: 'running', page: '2', pageSize: '50' })).toMatchObject({
      provider: ['AWS', 'GCP'],
      powerState: ['RUNNING'],
      page: 2,
      pageSize: 50,
    });
  });

  it('rejects invalid values', () => {
    expect(vmListQuerySchema.safeParse({ provider: 'ORACLE' }).success).toBe(false);
    expect(vmListQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(vmListQuerySchema.safeParse({ sortBy: 'rawData' }).success).toBe(false);
    expect(vmListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
});

describe('buildVmWhere / buildVmOrderBy', () => {
  it('empty query -> no filter', () => {
    expect(buildVmWhere(vmListQuerySchema.parse({}))).toEqual({});
  });

  it('combines filters with AND and search with OR (incl. exact IP match)', () => {
    const where = buildVmWhere(vmListQuerySchema.parse({ provider: 'AWS', lifecycle: 'ACTIVE', search: '10.0.0.1' }));
    expect(where.AND).toHaveLength(3);
    expect(JSON.stringify(where)).toContain('"ipAddresses":{"has":"10.0.0.1"}');
  });

  it('puts NULLs last for nullable sort fields and adds id as tie-breaker', () => {
    expect(buildVmOrderBy(vmListQuerySchema.parse({ sortBy: 'memoryMb', sortOrder: 'desc' }))).toEqual([
      { memoryMb: { sort: 'desc', nulls: 'last' } },
      { id: 'asc' },
    ]);
    expect(buildVmOrderBy(vmListQuerySchema.parse({}))).toEqual([{ name: 'asc' }, { id: 'asc' }]);
  });
});
