/** Dashboard – every number comes from GET /dashboard/summary and GET /drift/reports/latest. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { endpoints } from '../api/endpoints';
import type { ApiError } from '../api/client';
import { pollUntil, useApi } from '../hooks/useApi';
import { DRIFT_LABEL, formatDisk, formatMemory, formatNumber, PROVIDER_COLOR, PROVIDER_LABEL, timeAgo, formatDateTime } from '../lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, Skeleton, Spinner, Stat, StatusBadge } from '../components/ui/primitives';

export function DashboardPage() {
  const summary = useApi(() => endpoints.dashboard());
  const drift = useApi(() => endpoints.latestDrift());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function runCollection() {
    setBusy(true);
    setNotice(null);
    try {
      const { runId } = await endpoints.startCollection();
      let status = 'RUNNING';
      await pollUntil(async () => {
        status = (await endpoints.collection(runId)).status;
        return status !== 'RUNNING';
      });
      setNotice({ tone: status === 'FAILED' ? 'error' : 'success', text: `Collection finished: ${status} (MOCK provider data).` });
      summary.reload();
    } catch (e) {
      setNotice({ tone: 'error', text: (e as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Inventory health across AWS, Azure, Google Cloud, Proxmox and VMware."
        actions={
          <>
            <Button variant="secondary" onClick={() => { summary.reload(); drift.reload(); }}>Refresh</Button>
            <Button onClick={runCollection} disabled={busy}>{busy && <Spinner />} Run collection</Button>
          </>
        }
      />
      {notice && <div className="mb-4"><Notice tone={notice.tone}>{notice.text}</Notice></div>}
      {summary.error && <ErrorState message={summary.error.message} onRetry={summary.reload} />}

      {!summary.error && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {s ? (
              <>
                <Stat label="Total VMs" value={formatNumber(s.vms.total)} hint={`${s.vms.active} active · ${s.providers.length} providers`} accent="#6366f1" />
                <Stat label="Running" value={formatNumber(s.vms.running)} hint={`${s.vms.suspended} suspended · ${s.vms.unknown} unknown`} accent="#10b981" />
                <Stat label="Stopped" value={formatNumber(s.vms.stopped)} hint="Active VMs powered off" accent="#94a3b8" />
                <Stat label="Decommissioned" value={formatNumber(s.vms.decommissioned)} hint="No longer at the provider" accent="#334155" />
              </>
            ) : (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
            )}
          </div>

          {s && s.vms.total === 0 ? (
            <div className="mt-6">
              <Card><EmptyState title="No inventory yet" description="Run a collection to load the MOCK provider sample data." action={<Button onClick={runCollection} disabled={busy}>Run collection</Button>} /></Card>
            </div>
          ) : (
            <div className="mt-6 grid gap-6 xl:grid-cols-3">
              {/* Provider distribution */}
              <Card title="VMs by provider" subtitle="Active VMs per provider" className="xl:col-span-2">
                {s ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={s.providers.map((p) => ({ name: PROVIDER_LABEL[p.provider], vms: p.vms, provider: p.provider }))} margin={{ left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                        <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }} />
                        <Bar dataKey="vms" radius={[6, 6, 0, 0]} maxBarSize={56}>
                          {s.providers.map((p) => <Cell key={p.provider} fill={PROVIDER_COLOR[p.provider]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : <Skeleton className="h-64" />}
              </Card>

              {/* Capacity */}
              <Card title="Capacity" subtitle="Provisioned resources of active VMs">
                {s ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div><p className="text-xs text-slate-500">vCPU</p><p className="text-lg font-semibold tabular-nums">{formatNumber(s.resources.cpuCores)}</p></div>
                      <div><p className="text-xs text-slate-500">Memory</p><p className="text-lg font-semibold tabular-nums">{formatMemory(s.resources.memoryMb)}</p></div>
                      <div><p className="text-xs text-slate-500">Disk</p><p className="text-lg font-semibold tabular-nums">{formatDisk(s.resources.diskGb)}</p></div>
                    </div>
                    <table className="w-full text-xs">
                      <thead className="text-slate-500"><tr><th className="pb-2 text-left font-medium">Provider</th><th className="pb-2 text-right font-medium">VMs</th><th className="pb-2 text-right font-medium">vCPU</th><th className="pb-2 text-right font-medium">RAM</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {s.providers.map((p) => (
                          <tr key={p.provider}>
                            <td className="py-1.5"><span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ background: PROVIDER_COLOR[p.provider] }} />{PROVIDER_LABEL[p.provider]}</td>
                            <td className="py-1.5 text-right tabular-nums">{p.vms}</td>
                            <td className="py-1.5 text-right tabular-nums">{p.cpuCores}</td>
                            <td className="py-1.5 text-right tabular-nums">{formatMemory(p.memoryMb)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <Skeleton className="h-56" />}
              </Card>

              {/* Latest collection */}
              <Card title="Latest collection" action={<Link to="/jobs" className="text-xs font-medium text-indigo-600 hover:underline">History</Link>}>
                {!s ? <Skeleton className="h-20" /> : s.lastCollection ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between"><StatusBadge status={s.lastCollection.status} /><span className="text-xs text-slate-500">{s.lastCollection.trigger}</span></div>
                    <p className="text-slate-600">Finished {timeAgo(s.lastCollection.finishedAt)} <span className="text-slate-400">· {formatDateTime(s.lastCollection.finishedAt)}</span></p>
                    <p className="text-xs text-slate-500">Source: MOCK provider sample files</p>
                  </div>
                ) : <p className="text-sm text-slate-500">No collection has run yet.</p>}
              </Card>

              {/* Latest sync */}
              <Card title="Latest synchronization" action={<Link to="/sync" className="text-xs font-medium text-indigo-600 hover:underline">Open</Link>}>
                {!s ? <Skeleton className="h-20" /> : s.lastSync ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between"><StatusBadge status={s.lastSync.status} />{s.lastSync.simulated && <Badge tone="violet">SIMULATION</Badge>}</div>
                    <p className="text-slate-600">{timeAgo(s.lastSync.finishedAt)} · {s.lastSync.createdCount} created · {s.lastSync.updatedCount} updated · {s.lastSync.skippedCount} skipped</p>
                    {(s.lastSync.failedCount > 0 || s.lastSync.duplicateCount > 0) && <p className="text-xs text-rose-600">{s.lastSync.failedCount} failed · {s.lastSync.duplicateCount} duplicate</p>}
                    {s.lastSync.simulated && <p className="text-xs text-slate-500">Simulated NetBox – not a real NetBox sync.</p>}
                  </div>
                ) : <p className="text-sm text-slate-500">No synchronization has run yet.</p>}
              </Card>

              {/* Latest drift */}
              <Card title="Latest drift report" action={<Link to="/drift" className="text-xs font-medium text-indigo-600 hover:underline">Open</Link>}>
                {drift.loading && !drift.data ? <Skeleton className="h-20" /> : drift.error ? (
                  <p className="text-sm text-rose-600">{drift.error.message}</p>
                ) : drift.data ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-semibold tabular-nums">{drift.data.totalItems}</span>
                      <Badge tone="violet">{drift.data.target}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="red">{drift.data.summary.bySeverity.CRITICAL} critical</Badge>
                      <Badge tone="amber">{drift.data.summary.bySeverity.WARNING} warning</Badge>
                      <Badge tone="blue">{drift.data.summary.bySeverity.INFO} info</Badge>
                    </div>
                    <ul className="text-xs text-slate-500">
                      {Object.entries(drift.data.summary.byType).filter(([, n]) => n > 0).map(([t, n]) => <li key={t}>{DRIFT_LABEL[t]}: {n}</li>)}
                    </ul>
                    <p className="text-xs text-slate-400">Generated {timeAgo(drift.data.generatedAt)}</p>
                  </div>
                ) : <p className="text-sm text-slate-500">No drift report yet.</p>}
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );
}
