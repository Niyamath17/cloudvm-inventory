/**
 * Drift & orphans – differences between the collected inventory and the NetBox target.
 * Data: GET /drift/reports/latest, POST /drift/reports, POST /drift/reports/:id/remediate, POST /sync.
 *
 * Remediation only marks VMs for re-sync (the next sync corrects NetBox). Orphan and
 * duplicate records are NEVER deleted or merged automatically – they need a human decision.
 */
import { useMemo, useState } from 'react';
import { endpoints } from '../api/endpoints';
import type { ApiError } from '../api/client';
import type { DriftItemDto, DriftSeverity, DriftType } from '../api/types';
import { pollUntil, useApi } from '../hooks/useApi';
import { DRIFT_LABEL, formatDateTime, timeAgo } from '../lib/format';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Notice, PageHeader, SimulationBanner, Skeleton, Spinner, Stat, StatusBadge } from '../components/ui/primitives';
import { VmDetailDrawer } from '../components/VmDetailDrawer';

const TYPES: DriftType[] = ['MISSING_IN_NETBOX', 'ORPHAN_IN_NETBOX', 'DUPLICATE', 'POWER_STATE_MISMATCH', 'RESOURCE_MISMATCH'];
const SEVERITIES: DriftSeverity[] = ['CRITICAL', 'WARNING', 'INFO'];
const FIXABLE: DriftType[] = ['MISSING_IN_NETBOX', 'RESOURCE_MISMATCH', 'POWER_STATE_MISMATCH'];
const TYPE_HELP: Record<DriftType, string> = {
  MISSING_IN_NETBOX: 'Collected VM has no matching NetBox record. Fix: re-sync creates it.',
  ORPHAN_IN_NETBOX: 'NetBox record with no collected VM. Manual review – never deleted automatically.',
  DUPLICATE: 'Several NetBox records claim the same VM. Manual review – never merged or deleted automatically.',
  POWER_STATE_MISMATCH: 'NetBox status disagrees with the provider power/lifecycle state. Fix: re-sync updates it.',
  RESOURCE_MISMATCH: 'vCPU / memory / disk / name / cluster differ. Fix: re-sync updates NetBox.',
};

type Msg = { tone: 'success' | 'error' | 'info'; text: string };

export function DriftPage() {
  const report = useApi(() => endpoints.latestDrift());
  const [typeFilter, setTypeFilter] = useState<DriftType | 'ALL'>('ALL');
  const [sevFilter, setSevFilter] = useState<DriftSeverity | 'ALL'>('ALL');
  const [busy, setBusy] = useState<null | 'generate' | 'remediate' | 'sync'>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<Msg | null>(null);
  const [remediated, setRemediated] = useState<{ reportId: string; marked: number; manual: number } | null>(null);
  const [vmId, setVmId] = useState<string | null>(null);

  const r = report.data;
  const items = useMemo(
    () => (r?.items ?? []).filter((i) => (typeFilter === 'ALL' || i.type === typeFilter) && (sevFilter === 'ALL' || i.severity === sevFilter)),
    [r, typeFilter, sevFilter],
  );
  const fixable = (r?.items ?? []).filter((i) => FIXABLE.includes(i.type)).length;
  const manual = (r?.items ?? []).length - fixable;

  async function generate() {
    setBusy('generate');
    setNotice(null);
    try {
      const created = await endpoints.generateDrift();
      setRemediated(null);
      setTypeFilter('ALL');
      setSevFilter('ALL');
      report.reload();
      setNotice({ tone: created.totalItems === 0 ? 'success' : 'info', text: `New drift report generated: ${created.totalItems} finding(s) (${created.label}).` });
    } catch (e) {
      setNotice({ tone: 'error', text: (e as ApiError).message });
    } finally {
      setBusy(null);
    }
  }

  async function remediate() {
    if (!r) return;
    setBusy('remediate');
    setConfirming(false);
    setNotice(null);
    try {
      const res = await endpoints.remediateDrift(r.id);
      setRemediated({ reportId: r.id, marked: res.markedForResync, manual: res.manualActionRequired });
      setNotice({ tone: 'success', text: `${res.markedForResync} VM(s) marked for re-sync. Nothing has been written yet – run a sync to apply the corrections.${res.manualActionRequired ? ` ${res.manualActionRequired} orphan/duplicate finding(s) still need a manual decision.` : ''}` });
    } catch (e) {
      setNotice({ tone: 'error', text: (e as ApiError).message });
    } finally {
      setBusy(null);
    }
  }

  async function syncThenRecheck() {
    setBusy('sync');
    setNotice(null);
    try {
      const { syncRunId } = await endpoints.startSync();
      let status = 'RUNNING';
      await pollUntil(async () => {
        status = (await endpoints.syncRun(syncRunId)).status;
        return status !== 'RUNNING';
      });
      if (status === 'RUNNING') {
        setNotice({ tone: 'info', text: 'Sync is still running – generate a new report once it finishes.' });
        return;
      }
      const created = await endpoints.generateDrift();
      setRemediated(null);
      report.reload();
      setNotice({ tone: status === 'FAILED' ? 'error' : 'success', text: `Simulated sync ${status}. New drift report: ${created.totalItems} finding(s) remaining.` });
    } catch (e) {
      setNotice({ tone: 'error', text: (e as ApiError).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Drift & orphans"
        description="Compares the collected inventory with the NetBox target and lists every difference."
        actions={
          <>
            <Button variant="secondary" onClick={report.reload}>Refresh</Button>
            <Button onClick={generate} disabled={!!busy}>{busy === 'generate' && <Spinner />} Generate report</Button>
          </>
        }
      />
      {r && r.target === 'SIMULATION' && <SimulationBanner label={r.label} />}
      {notice && <div className="mb-4"><Notice tone={notice.tone}>{notice.text}</Notice></div>}

      {report.error ? (
        <ErrorState message={report.error.message} onRetry={report.reload} />
      ) : report.loading && !r ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)}</div>
      ) : !r ? (
        <Card><EmptyState title="No drift report yet" description="Generate a report to compare the collected inventory with the NetBox target (SIMULATION)." action={<Button onClick={generate} disabled={!!busy}>Generate report</Button>} /></Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Findings" value={r.totalItems} hint={`Generated ${timeAgo(r.generatedAt)} · ${formatDateTime(r.generatedAt)}`} accent="#6366f1" />
            <Stat label="Critical" value={r.summary.bySeverity.CRITICAL} accent="#e11d48" />
            <Stat label="Warning" value={r.summary.bySeverity.WARNING} accent="#f59e0b" />
            <Stat label="Info" value={r.summary.bySeverity.INFO} hint={`Compared ${r.summary.comparedLocal} collected VMs with ${r.summary.comparedRemote} NetBox records`} accent="#0ea5e9" />
          </div>

          {r.totalItems === 0 ? (
            <Card><EmptyState title="No drift detected" description="Every collected VM matches its NetBox record. Re-generate after the next collection or sync." /></Card>
          ) : (
            <>
              {/* By type – click to filter */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {TYPES.map((t) => {
                  const n = r.summary.byType[t];
                  const active = typeFilter === t;
                  return (
                    <button key={t} onClick={() => setTypeFilter(active ? 'ALL' : t)} disabled={n === 0}
                      className={cx('rounded-xl border bg-white p-4 text-left transition-colors disabled:cursor-default disabled:opacity-60', active ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300')}>
                      <p className="text-xs font-medium text-slate-500">{DRIFT_LABEL[t]}</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{n}</p>
                      <p className="mt-1 text-[11px] leading-snug text-slate-500">{TYPE_HELP[t]}</p>
                    </button>
                  );
                })}
              </div>

              {/* Remediation */}
              <Card title="Remediation" subtitle="Marks fixable findings for re-sync. Orphans and duplicates are never deleted automatically.">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="text-sm text-slate-600">
                    <p><strong className="text-slate-900">{fixable}</strong> finding(s) can be corrected by re-sync (missing, resource, power-state).</p>
                    <p><strong className="text-slate-900">{manual}</strong> finding(s) need a manual decision (orphan, duplicate).</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {remediated?.reportId === r.id ? (
                      <Button onClick={syncThenRecheck} disabled={!!busy}>{busy === 'sync' && <Spinner />} Run sync &amp; re-check</Button>
                    ) : confirming ? (
                      <>
                        <span className="text-xs text-slate-600">Reset sync state for {fixable} VM(s)?</span>
                        <Button variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
                        <Button onClick={remediate} disabled={!!busy}>Confirm</Button>
                      </>
                    ) : (
                      <Button onClick={() => setConfirming(true)} disabled={!!busy || fixable === 0}>{busy === 'remediate' && <Spinner />} Mark for re-sync</Button>
                    )}
                  </div>
                </div>
              </Card>

              {/* Findings */}
              <Card
                title="Findings"
                subtitle={`${items.length} of ${r.totalItems} shown${typeFilter !== 'ALL' ? ` · ${DRIFT_LABEL[typeFilter]}` : ''}`}
                padded={false}
                action={
                  <div className="flex flex-wrap gap-1">
                    {(['ALL', ...SEVERITIES] as const).map((s) => (
                      <button key={s} onClick={() => setSevFilter(s)} className={cx('rounded-md px-2 py-1 text-[11px] font-semibold', sevFilter === s ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>
                        {s === 'ALL' ? 'All severities' : `${s} (${r.summary.bySeverity[s]})`}
                      </button>
                    ))}
                  </div>
                }
              >
                {items.length === 0 ? (
                  <EmptyState title="No findings match these filters" action={<Button variant="secondary" onClick={() => { setTypeFilter('ALL'); setSevFilter('ALL'); }}>Clear filters</Button>} />
                ) : (
                  <FindingsTable items={items} onOpenVm={setVmId} />
                )}
              </Card>
            </>
          )}
        </div>
      )}
      <VmDetailDrawer id={vmId} onClose={() => setVmId(null)} />
    </>
  );
}

/** Findings grouped by drift type. */
function FindingsTable({ items, onOpenVm }: { items: DriftItemDto[]; onOpenVm: (id: string) => void }) {
  const groups = TYPES.map((t) => ({ type: t, rows: items.filter((i) => i.type === t) })).filter((g) => g.rows.length > 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-5 py-2.5 font-medium">Severity</th>
            <th className="px-3 py-2.5 font-medium">VM</th>
            <th className="px-3 py-2.5 font-medium">Field</th>
            <th className="px-3 py-2.5 font-medium">Collected inventory</th>
            <th className="px-3 py-2.5 font-medium">NetBox target</th>
            <th className="px-5 py-2.5 font-medium">Action</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.type} className="divide-y divide-slate-100 border-t border-slate-200">
            <tr className="bg-slate-50/60">
              <td colSpan={6} className="px-5 py-2 text-xs font-semibold text-slate-700">{DRIFT_LABEL[g.type]} <span className="font-normal text-slate-400">· {g.rows.length}</span></td>
            </tr>
            {g.rows.map((i) => (
              <tr key={i.id}>
                <td className="px-5 py-2.5"><StatusBadge status={i.severity} /></td>
                <td className="px-3 py-2.5">
                  {i.vmId ? (
                    <button onClick={() => onOpenVm(i.vmId!)} className="font-medium text-indigo-700 hover:underline">{i.name}</button>
                  ) : (
                    <span className="font-medium text-slate-800">{i.name}</span>
                  )}
                  {i.remoteId !== null && <span className="ml-2 font-mono text-[11px] text-slate-400">NetBox #{i.remoteId}</span>}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{i.field ?? '—'}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-800">{i.expected ?? '—'}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-800">{i.actual ?? '—'}</td>
                <td className="px-5 py-2.5 text-xs">
                  {FIXABLE.includes(i.type) ? <Badge tone="blue">Re-sync</Badge> : <Badge tone="amber">Manual review</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
