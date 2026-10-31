/** Application shell: sidebar navigation + top bar with data-source / NetBox-mode indicators. */
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { endpoints } from '../../api/endpoints';
import { useApi } from '../../hooks/useApi';
import { Badge, cx } from '../ui/primitives';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'M3 12l2-2 7-7 7 7 2 2M5 10v10h5v-6h4v6h5V10' },
  { to: '/inventory', label: 'VM Inventory', icon: 'M4 6h16M4 12h16M4 18h16' },
  { to: '/sync', label: 'Synchronization', icon: 'M4 4v6h6M20 20v-6h-6M5 15a7 7 0 0012 3M19 9A7 7 0 007 6' },
  { to: '/drift', label: 'Drift', icon: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z' },
  { to: '/jobs', label: 'Jobs', icon: 'M12 8v4l3 3M12 3a9 9 0 100 18 9 9 0 000-18z' },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const netbox = useApi(() => endpoints.netboxStatus());

  return (
    <div className="flex min-h-full bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <aside className={cx('fixed inset-y-0 left-0 z-40 w-60 transform bg-slate-950 text-slate-300 transition-transform lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-16 items-center gap-2.5 border-b border-white/5 px-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 text-sm font-bold text-white">C</div>
          <div>
            <p className="text-sm font-semibold text-white">CloudVM</p>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">VM Inventory</p>
          </div>
        </div>
        <nav className="space-y-0.5 p-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors', isActive ? 'bg-white/10 font-medium text-white' : 'hover:bg-white/5 hover:text-white')}
            >
              <Icon d={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-white/5 p-4 text-[11px] leading-relaxed text-slate-500">
          Provider data: <span className="font-semibold text-amber-400">MOCK</span> sample files.
          <br />
          NetBox: <span className="font-semibold text-amber-400">{netbox.data?.mode ?? '…'}</span>
          {netbox.data?.mode === 'SIMULATION' && ' – no real NetBox contacted.'}
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
              <Icon d="M4 6h16M4 12h16M4 18h16" />
            </button>
            <p className="hidden text-sm text-slate-500 sm:block">Multi-cloud VM inventory · NetBox source of truth</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="amber">MOCK PROVIDER DATA</Badge>
            {netbox.data && <Badge tone={netbox.data.mode === 'SIMULATION' ? 'violet' : 'green'} dot>NETBOX {netbox.data.mode}</Badge>}
            {netbox.error && <Badge tone="red" dot>API OFFLINE</Badge>}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
