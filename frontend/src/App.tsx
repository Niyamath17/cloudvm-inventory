/**
 * M0 placeholder.
 *
 * Only proves that React + TypeScript + Tailwind build and run, and that the
 * Vite proxy reaches the backend health endpoint. The real application shell
 * (sidebar, routing, dashboard) is built in milestone M7.
 */
import { useEffect, useState } from 'react';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; database: string; netboxMode: string }
  | { kind: 'error'; message: string };

export default function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/health', { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as {
          checks?: { database?: { status?: string }; netbox?: { mode?: string } };
        };
        setHealth({
          kind: 'ok',
          database: body.checks?.database?.status ?? 'unknown',
          netboxMode: body.checks?.netbox?.mode ?? 'unknown',
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setHealth({ kind: 'error', message: err instanceof Error ? err.message : 'Backend unreachable' });
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="flex min-h-full items-center justify-center bg-slate-50 p-6 font-sans text-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">CloudVM · M0 scaffold</p>
        <h1 className="mt-1 text-xl font-semibold">Multi-Cloud VM Inventory</h1>
        <p className="mt-2 text-sm text-slate-600">
          Frontend placeholder. The real UI is built in milestone M7.
        </p>

        <dl className="mt-5 space-y-2 text-sm">
          <Row label="Backend API">
            {health.kind === 'loading' && 'Checking…'}
            {health.kind === 'error' && <span className="text-red-600">Unreachable ({health.message})</span>}
            {health.kind === 'ok' && <span className="text-emerald-700">Reachable</span>}
          </Row>
          {health.kind === 'ok' && (
            <>
              <Row label="PostgreSQL">{health.database}</Row>
              <Row label="NetBox mode">
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                  {health.netboxMode}
                </span>
              </Row>
            </>
          )}
        </dl>
      </div>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
