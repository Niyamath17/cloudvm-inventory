/**
 * Jobs – collection history with provider-level outcomes, sync history and scheduler status.
 * Data: GET /collections, POST /collections, GET /collections/:id, GET /sync/runs.
 * The scheduler (M6) is not implemented; the page says so instead of showing a fake schedule.
 */
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { endpoints } from '../api/endpoints';
import type { ApiError } from '../api/client';
import type { CollectionRunDto } from '../api/types';
import { pollUntil, useApi } from '../hooks/useApi';
import { duration, formatDateTime, timeAgo } from '../lib/format';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Notice, PageHeader, Pager, ProviderTag, Skeleton, Spinner, StatusBadge } from '../components/ui/primitives';

export function JobsPage() {
  const [cPage, setCPage] = useState(1);
  const [sPage, setSPage] = useState(1);
  const collections = useApi(() => endpoints.collections(cPage, 10), [cPage]);
  const syncs = useApi(() => endpoints.syncRuns(sPage, 5), [sPage]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);

  async function runCollection() {
    setBusy(true);
    setNotice(null);
    try {
      const { runId } = await endpoints.startCollection();
      let run: CollectionRunDto | undefined;
      await pollUntil(async () => {
        run = await endpoints.collection(runId);
        return run.status !== 'RUNNING';
      });
      setCPage(1);
      setOpen(runId);
      collections.reload();
      if (!run || run.status === 'RUNNING') setNotice({ tone: 'info', text: 'Collection is still running – refresh in a moment.' });
      else setNotice({ tone: run.status === 'FAILED' ? 'error' : run.status === 'SUCCESS' ? 'success' : 'info', text: `Collection ${run.status} (MOCK provider data): ${run.discoveredCount} discovered, ${run.createdCount} created, ${run.updatedCount} updated, ${run.unchangedCount} unchanged, ${run.decommissionedCount} decommissioned.` });
    } catch (e) {
      setNotice({ tone: 'error', text: (e as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Collection and synchronization history, provider-level outcomes and scheduler status."
        actions={
          <>
            <Button variant="secondary" onClick={() => { collections.reload(); syncs.reload(); }}>Refresh</Button>
            <Button onClick={runCollection} disabled={busy}>{busy && <Spinner />} Run collection</Button>
          </>
        }
      />
      {notice && <div className="mb-4"><Notice tone={notice.tone}>{notice.text}</Notice></div>}

      <div className="space-y-6">
        {/* Scheduler – honest status */}
        <Card title="Scheduler" subtitle="Scheduled collection (milestone M6)">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Badge tone="amber" dot>NOT IMPLEMENTED</Badge>
              <p className="text-sm text-slate-600">No schedule is running. Collections and syncs run only when triggered manually (buttons on this page, Dashboard and Synchronization).</p>
            </div>
            <span className="text-xs text-slate-400">Planned: node-cron job, configurable interval</span>
          </div>
        </Card>

        {/* Collection history */}
        <Card title="Collection history" subtitle="Newest first · expand a run for provider-level results" padded={false}>
          {collections.error ? (
            <div className="p-4"><ErrorState message={collections.error.message} onRetry={collections.reload} /></div>
          ) : !collections.data ? (
            <div className="space-y-2 p-5">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : collections.data.pagination.total === 0 ? (
            <EmptyState title="No collections have run yet" description="Run a collection to load the MOCK provider sample data." action={<Button onClick={runCollection} disabled={busy}>Run collection</Button>} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="w-8 px-3 py-2.5" />
                      <th className="px-3 py-2.5 font-medium">Started</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">Trigger</th>
                      <th className="px-3 py-2.5 text-right font-medium">Discovered</th>
                      <th className="px-3 py-2.5 text-right font-medium">Created</th>
                      <th className="px-3 py-2.5 text-right font-medium">Updated</th>
                      <th className="px-3 py-2.5 text-right font-medium">Unchanged</th>
                      <th className="px-3 py-2.5 text-right font-medium">Decom.</th>
                      <th className="px-3 py-2.5 text-right font-medium">Invalid</th>
                      <th className="px-5 py-2.5 text-right font-medium">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {collections.data.data.map((c) => (
                      <Fragment key={c.id}>
                        <tr onClick={() => setOpen(open === c.id ? null : c.id)} className={cx('cursor-pointer hover:bg-slate-50', open === c.id && 'bg-indigo-50/60')}>
                          <td className="px-3 py-2.5 text-xs text-slate-400">{open === c.id ? '▾' : '▸'}</td>
                          <td className="px-3 py-2.5"><span className="font-medium text-slate-800">{timeAgo(c.startedAt)}</span> <span className="text-xs text-slate-400">{formatDateTime(c.startedAt)}</span></td>
                          <td className="px-3 py-2.5"><StatusBadge status={c.status} /></td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">{c.trigger}</td>
                          <N v={c.discoveredCount} /><N v={c.createdCount} /><N v={c.updatedCount} /><N v={c.unchangedCount} /><N v={c.decommissionedCount} /><N v={c.invalidCount} bad />
                          <td className="px-5 py-2.5 text-right text-xs text-slate-500">{duration(c.startedAt, c.finishedAt)}</td>
                        </tr>
                        {open === c.id && (
                          <tr><td colSpan={11} className="bg-slate-50/70 px-5 py-4"><ProviderResults run={c} /></td></tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={collections.data.pagination.page} totalPages={collections.data.pagination.totalPages} total={collections.data.pagination.total} onPage={setCPage} noun="collection runs" />
            </>
          )}
        </Card>

        {/* Sync history */}
        <Card title="Synchronization history" subtitle="NetBox target runs" padded={false} action={<Link to="/sync" className="text-xs font-medium text-indigo-600 hover:underline">Open Synchronization</Link>}>
          {syncs.error ? (
            <div className="p-4"><ErrorState message={syncs.error.message} onRetry={syncs.reload} /></div>
          ) : !syncs.data ? (
            <div className="space-y-2 p-5">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : syncs.data.pagination.total === 0 ? (
            <EmptyState title="No synchronization has run yet" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Started</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">Target</th>
                      <th className="px-3 py-2.5 font-medium">Result</th>
                      <th className="px-5 py-2.5 text-right font-medium">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {syncs.data.data.map((s) => (
                      <tr key={s.id}>
                        <td className="px-5 py-2.5"><span className="font-medium text-slate-800">{timeAgo(s.startedAt)}</span> <span className="text-xs text-slate-400">{formatDateTime(s.startedAt)}</span></td>
                        <td className="px-3 py-2.5"><StatusBadge status={s.status} /></td>
                        <td className="px-3 py-2.5"><Badge tone={s.target === 'SIMULATION' ? 'violet' : 'blue'}>{s.target}</Badge></td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">
                          {s.createdCount} created · {s.updatedCount} updated · {s.decommissionedCount} decom. · {s.skippedCount} skipped
                          {(s.failedCount > 0 || s.duplicateCount > 0) && <span className="text-rose-600"> · {s.failedCount} failed · {s.duplicateCount} duplicate</span>}
                        </td>
                        <td className="px-5 py-2.5 text-right text-xs text-slate-500">{duration(s.startedAt, s.finishedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager page={syncs.data.pagination.page} totalPages={syncs.data.pagination.totalPages} total={syncs.data.pagination.total} onPage={setSPage} noun="sync runs" />
            </>
          )}
        </Card>
      </div>
    </>
  );
}

function N({ v, bad }: { v: number; bad?: boolean }) {
  return <td className={cx('px-3 py-2.5 text-right tabular-nums', bad && v > 0 ? 'font-semibold text-rose-600' : v === 0 ? 'text-slate-400' : 'text-slate-800')}>{v}</td>;
}

function ProviderResults({ run }: { run: CollectionRunDto }) {
  return (
    <div className="space-y-3">
      {run.providerResults.length === 0 ? (
        <p className="text-xs text-slate-500">No provider results recorded for this run.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {run.providerResults.map((p) => (
            <div key={p.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between"><ProviderTag provider={p.provider} /><StatusBadge status={p.status} /></div>
              <p className="mt-2 text-lg font-semibold tabular-nums text-slate-900">{p.vmCount} <span className="text-xs font-normal text-slate-500">VMs</span></p>
              <p className="text-xs text-slate-500">{p.invalidCount} invalid · {p.durationMs} ms</p>
              <div className="mt-2"><Badge tone={p.dataSource === 'MOCK' ? 'amber' : 'green'}>{p.dataSource}</Badge></div>
              {p.error && <p className="mt-2 text-xs text-rose-700">{p.error}</p>}
            </div>
          ))}
        </div>
      )}
      {run.errors.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-700">Errors ({run.errors.length})</p>
          <ul className="space-y-1 text-xs text-rose-700">
            {run.errors.map((e, i) => <li key={i}><span className="font-semibold">{e.provider}</span>{e.ref ? ` · ${e.ref}` : ''}{e.stage ? ` · ${e.stage}` : ''}: {e.message}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
