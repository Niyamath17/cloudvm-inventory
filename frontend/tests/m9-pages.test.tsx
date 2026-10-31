/**
 * M9 page tests (API mocked): Synchronization, Drift, Jobs.
 * They check rendering of API data, SIMULATION labelling, the remediation flow
 * (confirm step, no delete action) and the honest scheduler status.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import { endpoints } from '../src/api/endpoints';
import { DriftPage } from '../src/pages/DriftPage';
import { JobsPage } from '../src/pages/JobsPage';
import { SyncPage } from '../src/pages/SyncPage';

vi.mock('../src/api/endpoints', () => ({
  endpoints: {
    netboxStatus: vi.fn(), syncRuns: vi.fn(), syncRun: vi.fn(), startSync: vi.fn(),
    latestDrift: vi.fn(), generateDrift: vi.fn(), remediateDrift: vi.fn(), vm: vi.fn(),
    collections: vi.fn(), collection: vi.fn(), startCollection: vi.fn(),
  },
}));
const m = vi.mocked(endpoints);
const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
const page = <T,>(data: T[]) => ({ data, pagination: { page: 1, pageSize: 10, total: data.length, totalPages: data.length ? 1 : 0 } });

const run = {
  id: 'r1', target: 'SIMULATION', status: 'SUCCESS', startedAt: '2026-10-31T06:00:00Z', finishedAt: '2026-10-31T06:00:01Z',
  createdCount: 55, updatedCount: 1, decommissionedCount: 1, skippedCount: 0, failedCount: 0, duplicateCount: 1, error: null,
};
const runDetail = {
  ...run,
  label: 'SIMULATION – local stand-in, no real NetBox instance is contacted',
  events: [
    { id: 'e1', syncRunId: 'r1', vmId: 'v1', vmName: 'web-1', action: 'CREATE', success: true, remoteId: 1, httpStatus: null, error: null, diff: null, createdAt: '2026-10-31T06:00:00Z' },
    { id: 'e2', syncRunId: 'r1', vmId: 'v2', vmName: 'db-1', action: 'UPDATE', success: true, remoteId: 2, httpStatus: null, error: null, diff: { memory: { from: 4096, to: 8192 } }, createdAt: '2026-10-31T06:00:00Z' },
    { id: 'e3', syncRunId: 'r1', vmId: 'v3', vmName: 'dup-1', action: 'SKIP', success: false, remoteId: null, httpStatus: null, error: 'DUPLICATE: 2 records with serial x – not written', diff: null, createdAt: '2026-10-31T06:00:00Z' },
  ],
};

const drift = {
  id: 'd1', target: 'SIMULATION', generatedAt: '2026-10-31T06:05:00Z', totalItems: 3,
  label: 'SIMULATION – compared with the local NetBox stand-in, not a real NetBox',
  summary: {
    totalItems: 3, comparedLocal: 58, comparedRemote: 58,
    byType: { MISSING_IN_NETBOX: 1, ORPHAN_IN_NETBOX: 1, RESOURCE_MISMATCH: 1, POWER_STATE_MISMATCH: 0, DUPLICATE: 0 },
    bySeverity: { CRITICAL: 0, WARNING: 2, INFO: 1 },
  },
  items: [
    { id: 'i1', type: 'MISSING_IN_NETBOX', severity: 'WARNING', vmId: 'v1', remoteId: null, name: 'web-1', field: null, expected: null, actual: null },
    { id: 'i2', type: 'ORPHAN_IN_NETBOX', severity: 'INFO', vmId: null, remoteId: 99, name: 'legacy-vm', field: null, expected: null, actual: null },
    { id: 'i3', type: 'RESOURCE_MISMATCH', severity: 'WARNING', vmId: 'v2', remoteId: 2, name: 'db-1', field: 'memoryMb', expected: '8192', actual: '4096' },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  m.netboxStatus.mockResolvedValue({ mode: 'SIMULATION', target: 'SIMULATION', label: 'SIMULATION – local stand-in, no real NetBox instance is contacted', simulatedRecords: 57 });
});

describe('SyncPage', () => {
  it('shows the SIMULATION banner, run counts, history and events', async () => {
    m.syncRuns.mockResolvedValue(page([run]) as never);
    m.syncRun.mockResolvedValue(runDetail as never);
    wrap(<SyncPage />);

    expect(await screen.findByText('57 simulated NetBox records')).toBeInTheDocument();
    expect(await screen.findByText('55', { selector: 'p' })).toBeInTheDocument(); // Stat tile, not the history cell
    expect(screen.getByText('web-1')).toBeInTheDocument();
    expect(screen.getByText('memory')).toBeInTheDocument();
    expect(screen.getByText('DUPLICATE: 2 records with serial x – not written')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Problems \(1\)/ }));
    expect(screen.queryByText('web-1')).not.toBeInTheDocument();
    expect(screen.getByText('dup-1')).toBeInTheDocument();
  });

  it('shows the empty state when no sync has run', async () => {
    m.syncRuns.mockResolvedValue(page([]) as never);
    wrap(<SyncPage />);
    expect(await screen.findByText('No synchronization has run yet')).toBeInTheDocument();
  });

  it('triggers a sync and reports the result as simulated', async () => {
    m.syncRuns.mockResolvedValue(page([run]) as never);
    m.syncRun.mockResolvedValue(runDetail as never);
    m.startSync.mockResolvedValue({ syncRunId: 'r1', target: 'SIMULATION', label: 'x' });
    wrap(<SyncPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run sync' }));
    expect(await screen.findByText(/No real NetBox was contacted/)).toBeInTheDocument();
    expect(m.startSync).toHaveBeenCalledTimes(1);
  });

  it('shows the 409 message when a sync is already running', async () => {
    m.syncRuns.mockResolvedValue(page([run]) as never);
    m.syncRun.mockResolvedValue(runDetail as never);
    m.startSync.mockRejectedValue(new ApiError('A synchronization is already running', 409, 'SYNC_IN_PROGRESS'));
    wrap(<SyncPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run sync' }));
    expect(await screen.findByText('A synchronization is already running')).toBeInTheDocument();
  });
});

describe('DriftPage', () => {
  it('shows counts by severity and type, grouped findings and the SIMULATION label', async () => {
    m.latestDrift.mockResolvedValue(drift as never);
    wrap(<DriftPage />);
    expect(await screen.findByText(drift.label)).toBeInTheDocument();
    expect(screen.getByText('legacy-vm')).toBeInTheDocument();
    expect(screen.getByText('NetBox #99')).toBeInTheDocument();
    expect(screen.getByText('memoryMb')).toBeInTheDocument();
    expect(screen.getAllByText('Manual review').length).toBe(1);
    expect(screen.getAllByText('Re-sync').length).toBe(2);
  });

  it('remediation needs confirmation, never offers deletion, and calls the API once', async () => {
    m.latestDrift.mockResolvedValue(drift as never);
    m.remediateDrift.mockResolvedValue({ markedForResync: 2, manualActionRequired: 1, next: 'POST /api/v1/sync' });
    wrap(<DriftPage />);
    await screen.findByText('legacy-vm');
    expect(screen.queryByRole('button', { name: /^\s*(delete|remove|merge)/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark for re-sync' }));
    expect(m.remediateDrift).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(m.remediateDrift).toHaveBeenCalledWith('d1'));
    expect(await screen.findByText(/2 VM\(s\) marked for re-sync/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run sync & re-check/ })).toBeInTheDocument();
  });

  it('filters findings by severity', async () => {
    m.latestDrift.mockResolvedValue(drift as never);
    wrap(<DriftPage />);
    await screen.findByText('legacy-vm');
    fireEvent.click(screen.getByRole('button', { name: 'INFO (1)' }));
    expect(screen.getByText('legacy-vm')).toBeInTheDocument();
    expect(screen.queryByText('db-1')).not.toBeInTheDocument();
  });

  it('shows the empty state when no report exists', async () => {
    m.latestDrift.mockResolvedValue(null);
    wrap(<DriftPage />);
    expect(await screen.findByText('No drift report yet')).toBeInTheDocument();
  });

  it('shows the error state when the API fails', async () => {
    m.latestDrift.mockRejectedValue(new ApiError('Database unavailable', 503, 'DB'));
    wrap(<DriftPage />);
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
  });
});

describe('JobsPage', () => {
  const collection = {
    id: 'c1', trigger: 'MANUAL', status: 'PARTIAL', startedAt: '2026-10-31T06:00:00Z', finishedAt: '2026-10-31T06:00:02Z',
    discoveredCount: 46, createdCount: 0, updatedCount: 0, unchangedCount: 46, decommissionedCount: 0, invalidCount: 0,
    errors: [{ provider: 'VMWARE', message: 'vCenter unreachable' }],
    providerResults: [
      { id: 'p1', provider: 'AWS', dataSource: 'MOCK', status: 'SUCCESS', vmCount: 12, invalidCount: 0, durationMs: 4, error: null },
      { id: 'p2', provider: 'VMWARE', dataSource: 'MOCK', status: 'FAILED', vmCount: 0, invalidCount: 0, durationMs: 1, error: 'vCenter unreachable' },
    ],
  };

  it('shows the scheduler as NOT IMPLEMENTED and collection history with provider results', async () => {
    m.collections.mockResolvedValue(page([collection]) as never);
    m.syncRuns.mockResolvedValue(page([run]) as never);
    wrap(<JobsPage />);
    expect(screen.getByText('NOT IMPLEMENTED')).toBeInTheDocument();
    expect(await screen.findByText('PARTIAL')).toBeInTheDocument();
    expect(screen.getByText(/55 created · 1 updated/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('PARTIAL'));
    expect(screen.getByText('vCenter unreachable')).toBeInTheDocument();
    expect(screen.getByText('Errors (1)')).toBeInTheDocument();
    expect(screen.getAllByText('MOCK').length).toBe(2);
  });

  it('shows empty states when nothing has run', async () => {
    m.collections.mockResolvedValue(page([]) as never);
    m.syncRuns.mockResolvedValue(page([]) as never);
    wrap(<JobsPage />);
    expect(await screen.findByText('No collections have run yet')).toBeInTheDocument();
    expect(await screen.findByText('No synchronization has run yet')).toBeInTheDocument();
  });
});
