/** VM inventory – server-side search, filters, sorting and pagination via GET /vms. */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { endpoints, type VmQuery } from '../api/endpoints';
import type { Vm } from '../api/types';
import { useApi } from '../hooks/useApi';
import { formatDisk, formatMemory, PROVIDER_LABEL, timeAgo } from '../lib/format';
import { Button, Card, cx, EmptyState, ErrorState, PageHeader, PowerBadge, ProviderTag, Skeleton } from '../components/ui/primitives';
import { VmDetailDrawer } from '../components/VmDetailDrawer';

const PROVIDERS = ['AWS', 'AZURE', 'GCP', 'PROXMOX', 'VMWARE'];
const POWER = ['RUNNING', 'STOPPED', 'SUSPENDED', 'UNKNOWN'];
type SortKey = 'name' | 'provider' | 'region' | 'cpuCores' | 'memoryMb' | 'diskGb' | 'powerState' | 'lastDiscoveredAt';

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx('rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors', active ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50')}>
      {children}
    </button>
  );
}

export function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [providers, setProviders] = useState<string[]>(params.get('provider')?.split(',').filter(Boolean) ?? []);
  const [power, setPower] = useState<string[]>([]);
  const [lifecycle, setLifecycle] = useState<'ALL' | 'ACTIVE' | 'DECOMMISSIONED'>('ALL');
  const [sortBy, setSortBy] = useState<SortKey>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<string | null>(null);
  const debounced = useDebounced(search);

  // Any filter change goes back to page 1.
  useEffect(() => setPage(1), [debounced, providers, power, lifecycle, pageSize]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (debounced) next.set('search', debounced);
    if (providers.length) next.set('provider', providers.join(','));
    setParams(next, { replace: true });
  }, [debounced, providers, setParams]);

  const query: VmQuery = useMemo(
    () => ({ page, pageSize, search: debounced, provider: providers, powerState: power, lifecycle, sortBy, sortOrder }),
    [page, pageSize, debounced, providers, power, lifecycle, sortBy, sortOrder],
  );
  const vms = useApi(() => endpoints.vms(query), [query]);
  const facets = useApi(() => endpoints.facets());

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const sort = (key: SortKey) => {
    if (sortBy === key) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else {
      setSortBy(key);
      setSortOrder(key === 'lastDiscoveredAt' || key === 'memoryMb' || key === 'cpuCores' || key === 'diskGb' ? 'desc' : 'asc');
    }
  };
  const count = (v: string) => facets.data?.providers.find((p) => p.value === v)?.count;
  const filtersActive = !!debounced || providers.length > 0 || power.length > 0 || lifecycle !== 'ALL';

  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={cx('px-4 py-2.5 font-medium', right && 'text-right')}>
      <button onClick={() => sort(k)} className={cx('inline-flex items-center gap-1 hover:text-slate-900', sortBy === k && 'text-slate-900')}>
        {children}
        <span className="text-[10px]">{sortBy === k ? (sortOrder === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );

  const p = vms.data?.pagination;
  return (
    <>
      <PageHeader title="VM Inventory" description="Normalized virtual machines from all providers (MOCK provider data)." />

      <Card padded={false}>
        {/* Filters */}
        <div className="space-y-3 border-b border-slate-100 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, hostname, IP, ID, OS, owner…"
              aria-label="Search VMs"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 md:max-w-md"
            />
            <select value={lifecycle} onChange={(e) => setLifecycle(e.target.value as typeof lifecycle)} aria-label="Lifecycle" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="ALL">All lifecycles</option>
              <option value="ACTIVE">Active</option>
              <option value="DECOMMISSIONED">Decommissioned</option>
            </select>
            {filtersActive && <Button variant="ghost" onClick={() => { setSearch(''); setProviders([]); setPower([]); setLifecycle('ALL'); }}>Clear filters</Button>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-medium text-slate-500">Provider</span>
            {PROVIDERS.map((v) => (
              <Chip key={v} active={providers.includes(v)} onClick={() => toggle(providers, setProviders, v)}>
                {PROVIDER_LABEL[v]}{count(v) !== undefined && <span className="ml-1 opacity-70">{count(v)}</span>}
              </Chip>
            ))}
            <span className="ml-3 mr-1 text-xs font-medium text-slate-500">Power</span>
            {POWER.map((v) => <Chip key={v} active={power.includes(v)} onClick={() => toggle(power, setPower, v)}>{v.toLowerCase()}</Chip>)}
          </div>
        </div>

        {vms.error && <div className="p-4"><ErrorState message={vms.error.message} onRetry={vms.reload} /></div>}

        {/* Table */}
        {!vms.error && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <Th k="name">VM</Th>
                  <Th k="provider">Provider</Th>
                  <Th k="region">Region / cluster</Th>
                  <th className="px-4 py-2.5 font-medium">IP addresses</th>
                  <Th k="cpuCores" right>vCPU</Th>
                  <Th k="memoryMb" right>RAM</Th>
                  <Th k="diskGb" right>Disk</Th>
                  <Th k="powerState">State</Th>
                  <th className="px-4 py-2.5 font-medium">Owner</th>
                  <Th k="lastDiscoveredAt">Last seen</Th>
                </tr>
              </thead>
              <tbody className={cx('divide-y divide-slate-100', vms.loading && vms.data && 'opacity-60')}>
                {!vms.data && vms.loading &&
                  Array.from({ length: 8 }, (_, i) => (
                    <tr key={i}><td colSpan={10} className="px-4 py-3"><Skeleton className="h-5" /></td></tr>
                  ))}
                {vms.data?.data.map((vm: Vm) => (
                  <tr key={vm.id} onClick={() => setSelected(vm.id)} className="cursor-pointer hover:bg-indigo-50/40">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{vm.name}</p>
                      <p className="max-w-[220px] truncate font-mono text-[11px] text-slate-500" title={vm.hostname ?? undefined}>{vm.hostname ?? <span className="italic">hostname unknown</span>}</p>
                    </td>
                    <td className="px-4 py-2.5"><ProviderTag provider={vm.provider} /></td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{vm.region ?? '—'}<br /><span className="text-slate-400">{vm.cluster ?? ''}</span></td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{vm.ipAddresses.length ? vm.ipAddresses.slice(0, 2).join(', ') : '—'}{vm.ipAddresses.length > 2 && ` +${vm.ipAddresses.length - 2}`}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{vm.cpuCores ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMemory(vm.memoryMb)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatDisk(vm.diskGb)}</td>
                    <td className="px-4 py-2.5"><PowerBadge state={vm.powerState} lifecycle={vm.lifecycle} /></td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{vm.owner ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{timeAgo(vm.lastDiscoveredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {vms.data && vms.data.data.length === 0 && (
              <EmptyState
                title={filtersActive ? 'No VMs match these filters' : 'No VMs in the inventory yet'}
                description={filtersActive ? 'Try a different search or clear the filters.' : 'Run a collection from the dashboard to load the MOCK sample data.'}
              />
            )}
          </div>
        )}

        {/* Pagination */}
        {p && p.total > 0 && (
          <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {(p.page - 1) * p.pageSize + 1}–{Math.min(p.page * p.pageSize, p.total)} of <strong>{p.total}</strong> VMs
            </span>
            <div className="flex items-center gap-2">
              <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page" className="rounded-md border border-slate-300 px-2 py-1 text-xs">
                {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
              </select>
              <Button variant="secondary" disabled={p.page <= 1} onClick={() => setPage(p.page - 1)}>Previous</Button>
              <span className="text-xs">Page {p.page} / {Math.max(1, p.totalPages)}</span>
              <Button variant="secondary" disabled={p.page >= p.totalPages} onClick={() => setPage(p.page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      <VmDetailDrawer id={selected} onClose={() => setSelected(null)} />
    </>
  );
}
