/** VM details (GET /vms/:id) in a slide-over panel. */
import { useEffect } from 'react';
import { endpoints } from '../api/endpoints';
import { useApi } from '../hooks/useApi';
import { formatDateTime, formatDisk, formatMemory, PROVIDER_LABEL } from '../lib/format';
import { Badge, ErrorState, PowerBadge, Skeleton, StatusBadge } from './ui/primitives';
import type { VmDetail } from '../api/types';

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm text-slate-900 ${mono ? 'font-mono text-xs' : ''}`}>{children ?? '—'}</dd>
    </div>
  );
}

function Detail({ vm }: { vm: VmDetail }) {
  const sim = vm.syncStates.find((s) => s.target === 'SIMULATION');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <PowerBadge state={vm.powerState} lifecycle={vm.lifecycle} />
        <Badge tone="amber">{vm.dataSource}</Badge>
        {vm.rawPowerState && <Badge>provider: {vm.rawPowerState}</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field label="Provider">{PROVIDER_LABEL[vm.provider]}</Field>
        <Field label="Account">{vm.account}</Field>
        <Field label="VM ID (scoped)" mono>{vm.externalId}</Field>
        <Field label="Native ID" mono>{vm.nativeId}</Field>
        <Field label="Hostname" mono>{vm.hostname ?? <span className="italic text-slate-400">unknown</span>}</Field>
        <Field label="IP addresses" mono>{vm.ipAddresses.length ? vm.ipAddresses.join(', ') : '—'}</Field>
        <Field label="Operating system">{vm.osName}</Field>
        <Field label="Owner">{vm.owner}</Field>
        <Field label="vCPU">{vm.cpuCores}</Field>
        <Field label="Memory">{formatMemory(vm.memoryMb)}</Field>
        <Field label="Disk">{formatDisk(vm.diskGb)}</Field>
        <Field label="Region / cluster">{[vm.region, vm.cluster].filter(Boolean).join(' / ') || '—'}</Field>
        <Field label="First discovered">{formatDateTime(vm.firstDiscoveredAt)}</Field>
        <Field label="Last discovered">{formatDateTime(vm.lastDiscoveredAt)}</Field>
        {vm.lifecycle === 'DECOMMISSIONED' && (
          <>
            <Field label="Decommissioned">{formatDateTime(vm.decommissionedAt)}</Field>
            <Field label="Reason">{vm.decommissionReason}</Field>
          </>
        )}
      </dl>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Tags</h3>
        {Object.keys(vm.tags).length ? (
          <div className="flex flex-wrap gap-1.5">{Object.entries(vm.tags).map(([k, v]) => <Badge key={k}>{k}{v !== 'true' && `: ${v}`}</Badge>)}</div>
        ) : <p className="text-sm text-slate-500">No tags</p>}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">NetBox sync <Badge tone="violet">SIMULATION</Badge></h3>
        {sim ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={sim.state} />
            <span className="text-slate-600">simulated record #{sim.simulatedVmId ?? '—'}</span>
            <span className="text-slate-500">synced {formatDateTime(sim.lastSyncedAt)}</span>
            {sim.lastError && <span className="text-rose-600">{sim.lastError}</span>}
          </div>
        ) : <p className="text-sm text-slate-500">Not synced yet.</p>}
        {vm.syncEvents.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            {vm.syncEvents.slice(0, 5).map((e) => (
              <li key={e.id}>{formatDateTime(e.createdAt)} · <strong>{e.action}</strong> {e.success ? '✓' : `✗ ${e.error ?? ''}`}</li>
            ))}
          </ul>
        )}
      </div>
      <details className="rounded-lg border border-slate-200">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600">Raw provider payload (MOCK)</summary>
        <pre className="max-h-80 overflow-auto bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-200">{JSON.stringify(vm.rawData, null, 2)}</pre>
      </details>
    </div>
  );
}

export function VmDetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const vm = useApi(() => (id ? endpoints.vm(id) : Promise.resolve(undefined)), [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!id) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <aside role="dialog" aria-label="VM details" className="relative h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl">
        <header className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div>
            <p className="text-xs text-slate-500">Virtual machine</p>
            <h2 className="text-lg font-semibold text-slate-900">{vm.data?.name ?? '…'}</h2>
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Close">✕</button>
        </header>
        <div className="p-6">
          {vm.error ? <ErrorState message={vm.error.message} onRetry={vm.reload} /> : vm.data ? <Detail vm={vm.data} /> : <div className="space-y-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div>}
        </div>
      </aside>
    </div>
  );
}
