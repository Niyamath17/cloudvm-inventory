/**
 * HttpNetBoxGateway against a local FAKE NetBox (node:http) that implements the few documented
 * endpoints CloudVM uses. This is a contract test of our client – NOT a test against real NetBox.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpNetBoxGateway } from '../../../src/modules/netbox/http.gateway.js';
import { NetBoxAuthError, NetBoxNameConflictError, NetBoxValidationError } from '../../../src/modules/netbox/NetBoxGateway.js';

interface FakeVm { id: number; name: string; serial: string; status: { value: string }; cluster: { id: number; name: string }; vcpus: number | null; memory: number | null; disk: number | null; description: string; comments: string; tags: Array<{ slug: string }> }
const fake = {
  vms: [] as FakeVm[],
  clusters: [] as Array<{ id: number; name: string; type: number }>,
  types: [] as Array<{ id: number; slug: string }>,
  tags: [] as Array<{ id: number; slug: string }>,
  requests: [] as Array<{ method: string; url: string; auth: string | undefined }>,
  failNext: [] as number[], // status codes to return for the next requests
  dropNextPost: false, // simulate: POST reaches the server but the response is lost
  nextId: 1,
};

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => (s += d)).on('end', () => resolve(s ? JSON.parse(s) : {}));
  });
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  fake.requests.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization });
  const send = (code: number, body?: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  if (req.headers.authorization !== 'Token test-token' && req.headers.authorization !== 'Bearer nbt_k.v') return send(403, { detail: 'Invalid token' });
  const status = fake.failNext.shift();
  if (status === 429) return send(429, { detail: 'slow down' }, { 'Retry-After': '0' });
  if (status) return send(status, { detail: 'boom' });

  const url = new URL(req.url ?? '/', 'http://x');
  const page = <T,>(results: T[]) => send(200, { count: results.length, results });
  const p = url.pathname;
  if (p === '/api/status/') return send(200, { 'netbox-version': '4.5.0' });
  if (p === '/api/extras/tags/') {
    if (req.method === 'GET') return page(fake.tags.filter((t) => t.slug === url.searchParams.get('slug')));
    const b = await readBody(req);
    const t = { id: fake.nextId++, slug: String(b.slug) };
    fake.tags.push(t);
    return send(201, t);
  }
  if (p === '/api/virtualization/cluster-types/') {
    if (req.method === 'GET') return page(fake.types.filter((t) => t.slug === url.searchParams.get('slug')));
    const b = await readBody(req);
    const t = { id: fake.nextId++, slug: String(b.slug) };
    fake.types.push(t);
    return send(201, t);
  }
  if (p === '/api/virtualization/clusters/') {
    if (req.method === 'GET') return page(fake.clusters.filter((c) => c.name === url.searchParams.get('name')));
    const b = await readBody(req);
    const c = { id: fake.nextId++, name: String(b.name), type: Number(b.type) };
    fake.clusters.push(c);
    return send(201, c);
  }
  if (p === '/api/virtualization/virtual-machines/') {
    if (req.method === 'GET') {
      const serial = url.searchParams.get('serial');
      const name = url.searchParams.get('name');
      const clusterId = Number(url.searchParams.get('cluster_id'));
      return page(fake.vms.filter((v) => (serial ? v.serial === serial : v.name === name && v.cluster.id === clusterId)));
    }
    const b = await readBody(req);
    const cluster = fake.clusters.find((c) => c.id === b.cluster)!;
    if (fake.vms.some((v) => v.name === b.name && v.cluster.id === cluster.id)) {
      return send(400, { __all__: ['Virtual machine with this Cluster, Tenant and Name already exists.'] });
    }
    const vm: FakeVm = { id: fake.nextId++, name: String(b.name), serial: String(b.serial), status: { value: String(b.status ?? 'active') }, cluster, vcpus: (b.vcpus as number) ?? null, memory: (b.memory as number) ?? null, disk: (b.disk as number) ?? null, description: String(b.description ?? ''), comments: String(b.comments ?? ''), tags: ((b.tags as number[]) ?? []).map((id) => ({ slug: fake.tags.find((t) => t.id === id)!.slug })) };
    fake.vms.push(vm);
    if (fake.dropNextPost) {
      fake.dropNextPost = false;
      req.socket.destroy(); // created, but the client never gets the response
      return;
    }
    return send(201, vm);
  }
  const m = /^\/api\/virtualization\/virtual-machines\/(\d+)\/$/.exec(p);
  if (m) {
    const vm = fake.vms.find((v) => v.id === Number(m[1]));
    if (!vm) return send(404, { detail: 'Not found.' });
    if (req.method === 'PATCH') {
      const b = await readBody(req);
      if (b.memory !== undefined) vm.memory = b.memory as number;
      if (b.status !== undefined) vm.status = { value: String(b.status) };
      if (b.name !== undefined) vm.name = String(b.name);
    }
    return send(200, vm);
  }
  return send(404, { detail: 'Not found.' });
}

let server: Server;
let baseUrl: string;
const gw = (token = 'test-token', scheme: 'Token' | 'Bearer' = 'Token') =>
  new HttpNetBoxGateway({ baseUrl, token, authScheme: scheme, timeoutMs: 2000, retry: { baseDelayMs: 1, maxDelayMs: 5 } });
const write = (over: Record<string, unknown> = {}) => ({
  name: 'web-01', serial: 'aws:123/ap-south-1/i-1', cluster: 'AWS/ap-south-1a', status: 'active', vcpus: 2, memory: 4096, disk: 30720,
  description: 'Managed by CloudVM – MOCK provider data', comments: 'x', tags: ['cloudvm-managed', 'cloudvm-mock'], ...over,
});

beforeAll(async () => {
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  Object.assign(fake, { vms: [], clusters: [], types: [], tags: [], requests: [], failNext: [], dropNextPost: false, nextId: 1 });
});

describe('HttpNetBoxGateway (fake NetBox server – contract test, not real NetBox)', () => {
  it('reads /api/status/ and sends "Token" auth', async () => {
    expect(await gw().status()).toEqual({ netboxVersion: '4.5.0' });
    expect(fake.requests[0]?.auth).toBe('Token test-token');
  });

  it('supports v2 "Bearer nbt_…" tokens', async () => {
    await gw('nbt_k.v', 'Bearer').status();
    expect(fake.requests[0]?.auth).toBe('Bearer nbt_k.v');
  });

  it('prepare() creates tags, cluster type and cluster once (idempotent)', async () => {
    const g = gw();
    await g.prepare([{ name: 'AWS/ap-south-1a', provider: 'AWS' }]);
    await gw().prepare([{ name: 'AWS/ap-south-1a', provider: 'AWS' }]);
    expect(fake.tags.map((t) => t.slug)).toEqual(['cloudvm-managed', 'cloudvm-mock']);
    expect(fake.types.map((t) => t.slug)).toEqual(['cloudvm-aws']);
    expect(fake.clusters.map((c) => c.name)).toEqual(['AWS/ap-south-1a']);
  });

  it('creates a VM, finds it by serial and by name, and PATCHes it', async () => {
    const g = gw();
    await g.prepare([{ name: 'AWS/ap-south-1a', provider: 'AWS' }]);
    const created = await g.createVm(write());
    expect(created).toMatchObject({ name: 'web-01', serial: 'aws:123/ap-south-1/i-1', status: 'active', cluster: 'AWS/ap-south-1a', tags: ['cloudvm-managed', 'cloudvm-mock'] });
    expect(await g.findBySerial('aws:123/ap-south-1/i-1')).toHaveLength(1);
    expect((await g.findByName('web-01', 'AWS/ap-south-1a'))?.id).toBe(created.id);
    const updated = await g.updateVm(created.id, { memory: 8192 });
    expect(updated.memory).toBe(8192);
    expect(await g.getVm(99999)).toBeNull(); // 404 -> null
  });

  it('maps a duplicate name to NetBoxNameConflictError', async () => {
    const g = gw();
    await g.prepare([{ name: 'AWS/ap-south-1a', provider: 'AWS' }]);
    await g.createVm(write());
    await expect(g.createVm(write({ serial: 'other' }))).rejects.toBeInstanceOf(NetBoxNameConflictError);
  });

  it('401/403 -> NetBoxAuthError (never retried)', async () => {
    await expect(gw('wrong').status()).rejects.toBeInstanceOf(NetBoxAuthError);
    expect(fake.requests).toHaveLength(1);
  });

  it('retries 503 and 429, then succeeds', async () => {
    fake.failNext = [503, 429];
    expect(await gw().status()).toEqual({ netboxVersion: '4.5.0' });
    expect(fake.requests).toHaveLength(3);
  });

  it('a 400 validation error is not retried', async () => {
    const g = gw();
    await g.prepare([{ name: 'AWS/ap-south-1a', provider: 'AWS' }]);
    fake.failNext = [400];
    await expect(g.updateVm(1, { memory: 1 })).rejects.toBeInstanceOf(NetBoxValidationError);
  });

  it('POST whose response is lost: looks up by serial and adopts instead of duplicating', async () => {
    const g = gw();
    await g.prepare([{ name: 'AWS/ap-south-1a', provider: 'AWS' }]);
    fake.dropNextPost = true;
    const vm = await g.createVm(write());
    expect(vm.serial).toBe('aws:123/ap-south-1/i-1');
    expect(fake.vms).toHaveLength(1); // no duplicate
  });
});
