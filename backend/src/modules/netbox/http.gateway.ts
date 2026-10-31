/**
 * HttpNetBoxGateway – real NetBox REST API client (used only when NETBOX_MODE=live).
 *
 * ⚠️ In this prototype it is verified against a local FAKE HTTP server in tests only.
 *    It has NOT been run against a real NetBox instance yet, and live mode is not enabled.
 *
 * Endpoints (documented NetBox REST API; no custom fields):
 *   GET  /api/status/
 *   GET|POST /api/extras/tags/                     (?slug=)
 *   GET|POST /api/virtualization/cluster-types/    (?slug=)
 *   GET|POST /api/virtualization/clusters/         (?name=)
 *   GET  /api/virtualization/virtual-machines/     (?serial=  |  ?name=&cluster_id=)
 *   GET|PATCH /api/virtualization/virtual-machines/{id}/
 *   POST /api/virtualization/virtual-machines/
 * DELETE is never used.
 *
 * Auth: "Authorization: Token <t>" (v1 tokens) or "Bearer nbt_<key>.<token>" (v2, NetBox ≥ 4.5).
 * Retries: GET/PATCH on 429/5xx/network/timeout (3 attempts, backoff + jitter, Retry-After).
 * POST is never blindly retried: after a transport failure the VM is looked up by serial first.
 */
import {
  NetBoxAuthError,
  NetBoxNameConflictError,
  NetBoxTransientError,
  NetBoxValidationError,
  type ClusterSpec,
  type NbVm,
  type NbVmWrite,
  type NetBoxGateway,
} from './NetBoxGateway.js';
import type { NetBoxReader } from './NetBoxReader.js';
import { RetryAfterError, withRetry, type RetryOptions } from './retry.js';

export interface HttpGatewayOptions {
  baseUrl: string;
  token: string;
  authScheme: 'Token' | 'Bearer';
  timeoutMs?: number;
  retry?: Partial<RetryOptions>;
  fetchImpl?: typeof fetch;
}

interface ApiVm {
  id: number;
  name: string;
  serial?: string | null;
  status?: { value: string } | null;
  cluster?: { id: number; name: string } | null;
  vcpus?: number | string | null;
  memory?: number | null;
  disk?: number | null;
  description?: string | null;
  comments?: string | null;
  tags?: Array<{ slug: string }>;
}
interface Page<T> {
  count: number;
  results: T[];
}

const TAGS = [
  { name: 'cloudvm-managed', slug: 'cloudvm-managed' },
  { name: 'cloudvm-mock', slug: 'cloudvm-mock' },
];

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export class HttpNetBoxGateway implements NetBoxGateway, NetBoxReader {
  readonly target = 'NETBOX' as const;
  readonly unsupportedFields = [] as const;
  private readonly baseUrl: string;
  private readonly retry: RetryOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly clusterIds = new Map<string, number>();
  private readonly tagIds = new Map<string, number>();

  constructor(private readonly opts: HttpGatewayOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.retry = { attempts: 3, baseDelayMs: 250, maxDelayMs: 10_000, ...opts.retry };
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // ─── low-level request ────────────────────────────────────────────────────
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `${this.opts.authScheme} ${this.opts.token}`,
          Accept: 'application/json',
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
    } catch (err) {
      throw new NetBoxTransientError(`NetBox request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;

    const text = await res.text().catch(() => '');
    const msg = `NetBox ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`;
    if (res.status === 401 || res.status === 403) throw new NetBoxAuthError(msg, res.status);
    if (res.status === 429) {
      const seconds = Number(res.headers.get('retry-after'));
      throw new RetryAfterError(msg, 429, Number.isFinite(seconds) ? seconds * 1000 : 1000);
    }
    if (res.status >= 500) throw new NetBoxTransientError(msg, res.status);
    if (res.status === 400 && /already exists|must be unique|unique/i.test(text)) throw new NetBoxNameConflictError(msg, 400);
    if (res.status === 404) throw new NetBoxValidationError(msg, 404);
    throw new NetBoxValidationError(msg, res.status);
  }

  private get<T>(path: string) {
    return withRetry(() => this.request<T>('GET', path), this.retry);
  }

  private toNbVm(v: ApiVm): NbVm {
    return {
      id: v.id,
      name: v.name,
      serial: v.serial || null,
      status: v.status?.value ?? null,
      cluster: v.cluster?.name ?? null,
      vcpus: v.vcpus === null || v.vcpus === undefined ? null : Number(v.vcpus),
      memory: v.memory ?? null,
      disk: v.disk ?? null,
      description: v.description ?? null,
      comments: v.comments ?? null,
      tags: (v.tags ?? []).map((t) => t.slug),
    };
  }

  private body(vm: Partial<NbVmWrite>) {
    const out: Record<string, unknown> = {};
    if (vm.name !== undefined) out.name = vm.name;
    if (vm.serial !== undefined) out.serial = vm.serial;
    if (vm.status !== undefined) out.status = vm.status;
    if (vm.vcpus !== undefined) out.vcpus = vm.vcpus;
    if (vm.memory !== undefined) out.memory = vm.memory;
    if (vm.disk !== undefined) out.disk = vm.disk;
    if (vm.description !== undefined) out.description = vm.description;
    if (vm.comments !== undefined) out.comments = vm.comments;
    if (vm.cluster !== undefined) {
      const id = this.clusterIds.get(vm.cluster);
      if (id === undefined) throw new NetBoxValidationError(`cluster "${vm.cluster}" was not prepared`);
      out.cluster = id;
    }
    if (vm.tags !== undefined) out.tags = vm.tags.flatMap((slug) => (this.tagIds.has(slug) ? [this.tagIds.get(slug)] : []));
    return out;
  }

  // ─── NetBoxGateway ────────────────────────────────────────────────────────
  async status(): Promise<{ netboxVersion: string }> {
    const s = await this.get<{ 'netbox-version': string }>('/api/status/');
    return { netboxVersion: s['netbox-version'] };
  }

  async prepare(clusters: ClusterSpec[]): Promise<void> {
    for (const tag of TAGS) {
      const found = await this.get<Page<{ id: number }>>(`/api/extras/tags/?slug=${tag.slug}`);
      const id = found.results[0]?.id ?? (await this.request<{ id: number }>('POST', '/api/extras/tags/', tag)).id;
      this.tagIds.set(tag.slug, id);
    }
    const typeIds = new Map<string, number>();
    for (const c of clusters) {
      if (this.clusterIds.has(c.name)) continue;
      const typeName = `CloudVM ${c.provider}`;
      const typeSlug = slugify(typeName);
      let typeId = typeIds.get(typeSlug);
      if (typeId === undefined) {
        const t = await this.get<Page<{ id: number }>>(`/api/virtualization/cluster-types/?slug=${typeSlug}`);
        typeId = t.results[0]?.id ?? (await this.request<{ id: number }>('POST', '/api/virtualization/cluster-types/', { name: typeName, slug: typeSlug })).id;
        typeIds.set(typeSlug, typeId);
      }
      const existing = await this.get<Page<{ id: number }>>(`/api/virtualization/clusters/?name=${encodeURIComponent(c.name)}`);
      const id = existing.results[0]?.id ?? (await this.request<{ id: number }>('POST', '/api/virtualization/clusters/', { name: c.name, type: typeId })).id;
      this.clusterIds.set(c.name, id);
    }
  }

  /** All VMs, paginated with limit/offset (NetBox's standard pagination). */
  async listVms(): Promise<NbVm[]> {
    const all: NbVm[] = [];
    const limit = 500;
    for (let offset = 0; ; offset += limit) {
      const page = await this.get<Page<ApiVm>>(`/api/virtualization/virtual-machines/?limit=${limit}&offset=${offset}`);
      all.push(...page.results.map((v) => this.toNbVm(v)));
      if (page.results.length < limit || all.length >= page.count) return all;
    }
  }

  async getVm(id: number): Promise<NbVm | null> {
    try {
      return this.toNbVm(await this.get<ApiVm>(`/api/virtualization/virtual-machines/${id}/`));
    } catch (err) {
      if (err instanceof NetBoxValidationError && err.httpStatus === 404) return null;
      throw err;
    }
  }

  async findBySerial(serial: string): Promise<NbVm[]> {
    const page = await this.get<Page<ApiVm>>(`/api/virtualization/virtual-machines/?serial=${encodeURIComponent(serial)}&limit=50`);
    // Filter client-side as well, in case the server's filter is a partial match.
    return page.results.map((v) => this.toNbVm(v)).filter((v) => v.serial === serial);
  }

  async findByName(name: string, cluster: string): Promise<NbVm | null> {
    const clusterId = this.clusterIds.get(cluster);
    if (clusterId === undefined) return null;
    const page = await this.get<Page<ApiVm>>(`/api/virtualization/virtual-machines/?name=${encodeURIComponent(name)}&cluster_id=${clusterId}`);
    const v = page.results.find((r) => r.name === name);
    return v ? this.toNbVm(v) : null;
  }

  async createVm(vm: NbVmWrite): Promise<NbVm> {
    try {
      return this.toNbVm(await this.request<ApiVm>('POST', '/api/virtualization/virtual-machines/', this.body(vm)));
    } catch (err) {
      if (!(err instanceof NetBoxTransientError)) throw err;
      // The POST may have reached NetBox before the connection failed: look before retrying.
      const existing = await this.findBySerial(vm.serial);
      if (existing.length === 1 && existing[0]) return existing[0];
      return this.toNbVm(await this.request<ApiVm>('POST', '/api/virtualization/virtual-machines/', this.body(vm)));
    }
  }

  async updateVm(id: number, patch: Partial<NbVmWrite>): Promise<NbVm> {
    return this.toNbVm(await withRetry(() => this.request<ApiVm>('PATCH', `/api/virtualization/virtual-machines/${id}/`, this.body(patch)), this.retry));
  }
}
