/**
 * Synchronization – NetBox sync runs and their per-VM events.
 * Data: GET /netbox/status, GET /sync/runs, GET /sync/runs/:id, POST /sync.
 * The target is SIMULATION in this prototype: results are never presented as a real NetBox sync.
 */
import { useEffect, useMemo, useState } from 'react';
import { endpoints } from '../api/endpoints';
import type { ApiError } from '../api/client';
import type { SyncEventDto, SyncRunDto } from '../api/types';
import { pollUntil, useApi } from '../hooks/useApi';
import { duration, formatDateTime, timeAgo } from '../lib/format';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Notice, PageHeader, Pager, SimulationBanner, Skeleton, Spinner, Stat, StatusBadge } from '../components/ui/primitives';

const ACTION_TONE = { CREATE: 'green', UPDATE: 'blue', DECOMMISSION: 'amber', SKIP: 'neutral' } as const;
type EventFilter = 'ALL' | 'CREATE' | 'UPDATE' | 'DECOMMISSION' | 'PROBLEMS';

export function SyncPage() {
  const status = useApi(() => endpoints.netboxStatus());
  const [page, setPage] = useState(1);
  const runs = useApi(() => endpoints.syncRuns(page, 10), [page]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Default selection: newest run.
  const firstId = runs.data?.data[0]?.id ?? null;
  const activeId = selectedId ?? firstId;

  async function runSync() {
    setBusy(true);
    setNotice(null);
    try {
      const { syncRunId } = await endpoints.startSync();
      let run: SyncRunDto | undefined;
      await pollUntil(async () => {
        run = await endpoints.syncRun(syncRunId);
        return run.status !== 'RUNNING';
      });
      setSelectedId(syncRunId);
      setPage(1);
      runs.reload();
      status.reload();
      if (!run || run.status === 'RUNNING') setNotice({ tone: 'info', text: 'Sync is still running – refresh in a moment.' });
      else if (run.status === 'FAILED') setNotice({ tone: 'error', text: `Simulated sync FAILED${run.error ? `: ${run.error}` : ''}.` });
      else setNotice({ tone: run.status === 'SUCCESS' ? 'success' : 'info', text: `Simulated sync ${run.status}: ${run.createdCount} created, ${run.updatedCount} updated, ${run.decommissionedCount} decommissioned, ${run.skippedCount} skipped, ${run.failedCount} failed, ${run.duplicateCount} duplicate. No real NetBox was contacted.` });
    } catch (e) {
      setNotice({ tone: 'error', text: (e as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  const simulated = status.data ? status.data.mode === 'SIMULATION' : true;
  return (
    <>
      <PageHeader
        title="Synchronization"
        description="Push the collected inventory to the NetBox target – create, update and decommission, idempotently."
        actions={
          <>
            <Button variant="secondary" onClick={() => { runs.reload(); status.reload(); }}>Refresh</Button>
            <Button onClick={runSync} disabled={busy}>{busy && <Spinner />} Run sync</Button>
          </>
        }
      />
      {status.data && simulated && (
        <SimulationBanner label={status.data.label} extra={status.data.simulatedRecords !== undefined ? `${status.data.simulatedRecords} simulated NetBox records` : undefined} />
      )}
      {status.data && !simulated && <div className="mb-6"><Notice tone="info">Target: {status.data.label}</Notice></div>}
      {status.error && <div className="mb-6"><ErrorState message={status.error.message} onRetry={status.reload} /></div>}
      {notice && <div className="mb-4"><Notice tone={notice.tone}>{notice.text}</Notice></div>}

      {runs.error ? (
        <ErrorState message={runs.error.message} onRetry={runs.reload} />
      ) : runs.data && runs.data.pagination.total === 0 ? (
        <Card><EmptyState title="No synchronization has run yet" description="Run a collection first (Dashboard), then run a sync. In SIMULATION mode records are written to a local NetBox stand-in." action={<Button onClick={runSync} disabled={busy}>Run sync</Button>} /></Card>
      ) : (
        <div className="space-y-6">
          <RunSummary runId={activeId} simulated={simulated} />
          <Card title="Sync history" subtitle="Newest first · click a run to see its events" padded={false}>
            {!runs.data ? (
              <div className="space-y-2 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-5 py-2.5 font-medium">Started</th>
                        <th className="px-3 py-2.5 font-medium">Status</th>
                        <th className="px-3 py-2.5 font-medium">Target</th>
                        <th className="px-3 py-2.5 text-right font-medium">Created</th>
                        <th className="px-3 py-2.5 text-right font-medium">Updated</th>
                        <th className="px-3 py-2.5 text-right font-medium">Decom.</th>
                        <th className="px-3 py-2.5 text-right font-medium">Skipped</th>
                        <th className="px-3 py-2.5 text-right font-medium">Failed</th>
                        <th className="px-3 py-2.5 text-right font-medium">Duplicate</th>
                        <th className="px-5 py-2.5 text-right font-medium">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {runs.data.data.map((r) => (
                        <tr key={r.id} onClick={() => setSelectedId(r.id)} className={cx('cursor-pointer hover:bg-slate-50', r.id === activeId && 'bg-indigo-50/60')}>
                          <td className="px-5 py-2.5"><span className="font-medium text-slate-800">{timeAgo(r.startedAt)}</span> <span className="text-xs text-slate-400">{formatDateTime(r.startedAt)}</span></td>
                          <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                          <td className="px-3 py-2.5"><Badge tone={r.target === 'SIMULATION' ? 'violet' : 'blue'}>{r.target}</Badge></td>
                          <Num v={r.createdCount} /><Num v={r.updatedCount} /><Num v={r.decommissionedCount} /><Num v={r.skippedCount} />
                          <Num v={r.failedCount} bad /><Num v={r.duplicateCount} bad />
                          <td className="px-5 py-2.5 text-right text-xs text-slate-500">{duration(r.startedAt, r.finishedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={runs.data.pagination.page} totalPages={runs.data.pagination.totalPages} total={runs.data.pagination.total} onPage={setPage} noun="sync runs" />
              </>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function Num({ v, bad }: { v: number; bad?: boolean }) {
  return <td className={cx('px-3 py-2.5 text-right tabular-nums', bad && v > 0 ? 'font-semibold text-rose-600' : v === 0 ? 'text-slate-400' : 'text-slate-800')}>{v}</td>;
}

/** Counts + per-VM events for one run (GET /sync/runs/:id). */
function RunSummary({ runId, simulated }: { runId: string | null; simulated: boolean }) {
  const run = useApi(() => (runId ? endpoints.syncRun(runId) : Promise.resolve(undefined)), [runId]);
  const [filter, setFilter] = useState<EventFilter>('ALL');
  useEffect(() => setFilter('ALL'), [runId]);

  const events = useMemo(() => {
    const all = run.data?.events ?? [];
    if (filter === 'ALL') return all;
    if (filter === 'PROBLEMS') return all.filter((e) => !e.success);
    return all.filter((e) => e.action === filter);
  }, [run.data, filter]);

  if (!runId) return null;
  if (run.error) return <ErrorState message={run.error.message} onRetry={run.reload} />;
  const r = run.data;
  if (!r) return <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)}</div>;

  const problems = r.events.filter((e) => !e.success).length;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Created" value={r.createdCount} accent="#10b981" />
        <Stat label="Updated" value={r.updatedCount} accent="#0ea5e9" />
        <Stat label="Decommissioned" value={r.decommissionedCount} accent="#f59e0b" />
        <Stat label="Skipped" value={r.skippedCount} hint="Unchanged – no write" accent="#94a3b8" />
        <Stat label="Failed" value={r.failedCount} accent="#e11d48" />
        <Stat label="Duplicate" value={r.duplicateCount} hint="Not written" accent="#be123c" />
      </div>

      <Card
        title={<span className="flex items-center gap-2">Run details <StatusBadge status={r.status} /></span>}
        subtitle={<>{formatDateTime(r.startedAt)} · {duration(r.startedAt, r.finishedAt)} · {r.label}</>}
        padded={false}
        action={
          <div className="flex flex-wrap gap-1">
            {(['ALL', 'CREATE', 'UPDATE', 'DECOMMISSION', 'PROBLEMS'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cx('rounded-md px-2 py-1 text-[11px] font-semibold', filter === f ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>
                {f === 'PROBLEMS' ? `Problems (${problems})` : f}
              </button>
            ))}
          </div>
        }
      >
        {r.error && <div className="border-b border-slate-100 p-4"><Notice tone="error">Run error: {r.error}</Notice></div>}
        {events.length === 0 ? (
          <EmptyState
            title={r.events.length === 0 ? 'No per-VM writes in this run' : 'No events match this filter'}
            description={r.events.length === 0 ? `All ${r.skippedCount} VMs were unchanged since their last sync, so nothing was written${simulated ? ' to the simulated NetBox' : ''}. Skipped VMs are counted but do not create events.` : undefined}
          />
        ) : (
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">VM</th>
                  <th className="px-3 py-2.5 font-medium">Action</th>
                  <th className="px-3 py-2.5 font-medium">Result</th>
                  <th className="px-3 py-2.5 font-medium">{simulated ? 'Simulated ID' : 'NetBox ID'}</th>
                  <th className="px-5 py-2.5 font-medium">Changes / error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">{events.map((e) => <EventRow key={e.id} e={e} />)}</tbody>
            </table>
          </div>
        )}
        <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">Showing {events.length} of {r.events.length} events. Duplicate records are reported, never merged or deleted automatically.</p>
      </Card>
    </>
  );
}

function EventRow({ e }: { e: SyncEventDto }) {
  const duplicate = e.error?.startsWith('DUPLICATE');
  return (
    <tr className="align-top">
      <td className="px-5 py-2.5 font-medium text-slate-800">{e.vmName}</td>
      <td className="px-3 py-2.5"><Badge tone={ACTION_TONE[e.action]}>{e.action}</Badge></td>
      <td className="px-3 py-2.5">{e.success ? <Badge tone="green" dot>OK</Badge> : <Badge tone="red" dot>{duplicate ? 'DUPLICATE' : 'FAILED'}</Badge>}</td>
      <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{e.remoteId ?? '—'}{e.httpStatus ? ` · HTTP ${e.httpStatus}` : ''}</td>
      <td className="px-5 py-2.5 text-xs">
        {e.error && <p className="text-rose-700">{e.error}</p>}
        {e.diff && (
          <ul className="space-y-0.5 font-mono text-[11px] text-slate-600">
            {Object.entries(e.diff).map(([field, d]) => (
              <li key={field}><span className="text-slate-900">{field}</span>: <span className="text-rose-600 line-through">{fmt(d.from)}</span> → <span className="text-emerald-700">{fmt(d.to)}</span></li>
            ))}
          </ul>
        )}
        {!e.error && !e.diff && <span className="text-slate-400">—</span>}
      </td>
    </tr>
  );
}

const fmt = (v: unknown) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
