/** Small design-system primitives used across pages. */
import type { ReactNode } from 'react';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export function Card({ title, subtitle, action, children, className, padded = true }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-3.5">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={padded ? 'p-5' : undefined}>{children}</div>
    </section>
  );
}

type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'slate';
const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  slate: 'bg-slate-800 text-slate-100 ring-slate-700',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
};
export function Badge({ tone = 'neutral', children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ring-inset', TONES[tone])}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  SUCCESS: 'green', SYNCED: 'green', RUNNING: 'blue', PARTIAL: 'amber', FAILED: 'red', SKIPPED: 'neutral',
  PENDING: 'neutral', DUPLICATE: 'red', ACTIVE: 'green', DECOMMISSIONED: 'neutral',
  CRITICAL: 'red', WARNING: 'amber', INFO: 'blue',
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'} dot>{status}</Badge>;
}

const POWER_TONE: Record<string, Tone> = { RUNNING: 'green', STOPPED: 'neutral', SUSPENDED: 'amber', UNKNOWN: 'violet' };
export function PowerBadge({ state, lifecycle }: { state: string; lifecycle?: string }) {
  if (lifecycle === 'DECOMMISSIONED') return <Badge tone="slate">DECOMMISSIONED</Badge>;
  return <Badge tone={POWER_TONE[state] ?? 'neutral'} dot>{state}</Badge>;
}

export function Button({ children, onClick, variant = 'primary', disabled, type = 'button', title }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost'; disabled?: boolean; type?: 'button' | 'submit'; title?: string }) {
  const styles = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-sm disabled:bg-indigo-300',
    secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
    ghost: 'text-slate-600 hover:bg-slate-100 disabled:text-slate-300',
  }[variant];
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} className={cx('inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed', styles)}>
      {children}
    </button>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)} aria-label="loading" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-slate-200/70', className)} />;
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 h-10 w-10 rounded-full bg-slate-100 ring-8 ring-slate-50" />
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between">
      <span><strong className="font-semibold">Could not load data.</strong> {message}</span>
      {onRetry && <Button variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'success' | 'error' | 'info'; children: ReactNode }) {
  const s = { success: 'border-emerald-200 bg-emerald-50 text-emerald-800', error: 'border-rose-200 bg-rose-50 text-rose-800', info: 'border-sky-200 bg-sky-50 text-sky-800' }[tone];
  return <div role="status" className={cx('rounded-lg border px-4 py-3 text-sm', s)}>{children}</div>;
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4">
      {accent && <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />}
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function ProviderTag({ provider }: { provider: string }) {
  const color = { AWS: '#f59e0b', AZURE: '#3b82f6', GCP: '#10b981', PROXMOX: '#f97316', VMWARE: '#8b5cf6' }[provider] ?? '#64748b';
  const label = { AWS: 'AWS', AZURE: 'Azure', GCP: 'GCP', PROXMOX: 'Proxmox', VMWARE: 'VMware' }[provider] ?? provider;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

/** Compact previous/next pager used by the history tables. */
export function Pager({ page, totalPages, total, onPage, noun = 'items' }: { page: number; totalPages: number; total: number; onPage: (p: number) => void; noun?: string }) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
      <span><strong>{total}</strong> {noun}</span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span>Page {page} / {Math.max(1, totalPages)}</span>
        <Button variant="secondary" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

/** Banner shown on every screen that reads or writes the NetBox target. */
export function SimulationBanner({ label, extra }: { label: string; extra?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-1 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 sm:flex-row sm:items-center sm:gap-3">
      <Badge tone="violet" dot>SIMULATION</Badge>
      <span>{label}</span>
      {extra && <span className="text-violet-700 sm:ml-auto">{extra}</span>}
    </div>
  );
}
