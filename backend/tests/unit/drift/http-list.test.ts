/** HttpNetBoxGateway.listVms pagination, with a stubbed fetch (no network, not real NetBox). */
import { describe, expect, it } from 'vitest';
import { HttpNetBoxGateway } from '../../../src/modules/netbox/http.gateway.js';

describe('HttpNetBoxGateway.listVms (stubbed fetch)', () => {
  it('follows limit/offset pagination until all records are read', async () => {
    const urls: string[] = [];
    const total = 750;
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get('offset'));
      const n = Math.min(500, total - offset);
      const results = Array.from({ length: n }, (_, i) => ({ id: offset + i + 1, name: `vm-${offset + i}`, serial: null, status: { value: 'active' }, cluster: { id: 1, name: 'c' }, tags: [] }));
      return new Response(JSON.stringify({ count: total, results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const gw = new HttpNetBoxGateway({ baseUrl: 'http://netbox.invalid', token: 't', authScheme: 'Token', fetchImpl });
    const vms = await gw.listVms();
    expect(vms).toHaveLength(750);
    expect(urls.map((u) => new URL(u).searchParams.get('offset'))).toEqual(['0', '500']);
  });
});
