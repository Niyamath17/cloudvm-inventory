/**
 * Page tests with the API layer mocked (no backend needed). They check that the
 * pages render what the API returns – nothing hard-coded – and that loading,
 * empty and error states appear.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import { endpoints } from '../src/api/endpoints';
import { DashboardPage } from '../src/pages/DashboardPage';
import { InventoryPage } from '../src/pages/InventoryPage';

vi.mock('../src/api/endpoints', () => ({
  endpoints: {
    dashboard: vi.fn(), latestDrift: vi.fn(), vms: vi.fn(), facets: vi.fn(), vm: vi.fn(),
    startCollection: vi.fn(), collection: vi.fn(),
  },
}));
const m = vi.mocked(endpoints);

const summary = {
  dataSource: 'MOCK',
  vms: { total: 60, active: 56, running: 39, stopped: 13, suspended: 2, unknown: 2, decommissioned: 4 },
  resources: { cpuCores: 321, memoryMb: 1_310_720, diskGb: 9000 },
  providers: [
    { provider: 'AWS', vms: 12, cpuCores: 60, memoryMb: 245_760, diskGb: 1200 },
    { provider: 'VMWARE', vms: 11, cpuCores: 70, memoryMb: 262_144, diskGb: 2200 },
  ],
  lastCollection: { id: 'c1', status: 'SUCCESS', trigger: 'MANUAL', startedAt: '2026-10-31T06:00:00Z', finishedAt: '2026-10-31T06:00:01Z' },
  lastSync: { id: 's1', target: 'SIMULATION', status: 'SUCCESS', startedAt: '2026-10-31T06:01:00Z', finishedAt: '2026-10-31T06:01:01Z', createdCount: 57, updatedCount: 0, decommissionedCount: 1, skippedCount: 0, failedCount: 0, duplicateCount: 0, simulated: true },
};

const vm = (i: number) => ({
  id: `vm-${i}`, provider: 'AWS', externalId: `111/ap-south-1/i-${i}`, nativeId: `i-${i}`, account: '111', name: `web-${i}`,
  hostname: `web-${i}.internal`, ipAddresses: [`10.0.0.${i}`], osName: 'Ubuntu 22.04', cpuCores: 2, memoryMb: 4096, diskGb: 50,
  region: 'ap-south-1', cluster: null, powerState: 'RUNNING', rawPowerState: 'running', owner: 'platform', tags: {}, dataSource: 'MOCK',
  lifecycle: 'ACTIVE', decommissionedAt: null, decommissionReason: null, firstDiscoveredAt: '2026-10-31T06:00:00Z', lastDiscoveredAt: '2026-10-31T06:00:00Z',
});

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  vi.resetAllMocks();
  m.facets.mockResolvedValue({ providers: [{ value: 'AWS', count: 2 }], powerStates: [], regions: [], clusters: [], owners: [] } as never);
});

describe('DashboardPage', () => {
  it('shows KPIs from the API and labels the sync as SIMULATION', async () => {
    m.dashboard.mockResolvedValue(summary as never);
    m.latestDrift.mockResolvedValue(null);
    wrap(<DashboardPage />);

    const total = await screen.findByText('Total VMs');
    expect(within(total.parentElement!).getByText('60')).toBeInTheDocument();
    expect(within(screen.getByText('Running').parentElement!).getByText('39')).toBeInTheDocument();
    expect(within(screen.getByText('Decommissioned').parentElement!).getByText('4')).toBeInTheDocument();
    expect(screen.getByText('SIMULATION')).toBeInTheDocument();
    expect(screen.getByText(/not a real NetBox sync/)).toBeInTheDocument();
    expect(screen.getByText('No drift report yet.')).toBeInTheDocument();
  });

  it('shows the empty state when the inventory is empty', async () => {
    m.dashboard.mockResolvedValue({ ...summary, vms: { ...summary.vms, total: 0 }, providers: [], lastCollection: null, lastSync: null } as never);
    m.latestDrift.mockResolvedValue(null);
    wrap(<DashboardPage />);
    expect(await screen.findByText('No inventory yet')).toBeInTheDocument();
  });

  it('shows an error state with the API message', async () => {
    m.dashboard.mockRejectedValue(new ApiError('Cannot reach the CloudVM API – is the backend running on port 4000?', null, 'NETWORK'));
    m.latestDrift.mockResolvedValue(null);
    wrap(<DashboardPage />);
    expect(await screen.findByText(/backend running on port 4000/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

describe('InventoryPage', () => {
  it('renders VM rows and pagination from the API', async () => {
    m.vms.mockResolvedValue({ data: [vm(1), vm(2)], pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 } } as never);
    wrap(<InventoryPage />);
    expect(await screen.findByText('web-1')).toBeInTheDocument();
    expect(screen.getByText('web-2.internal')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
    expect(screen.getAllByText('4 GiB').length).toBe(2);
    await waitFor(() => expect(m.vms).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 25, sortBy: 'name', sortOrder: 'asc' })));
  });

  it('shows the empty state when there are no VMs', async () => {
    m.vms.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } } as never);
    wrap(<InventoryPage />);
    expect(await screen.findByText('No VMs in the inventory yet')).toBeInTheDocument();
  });

  it('shows the error state when the API fails', async () => {
    m.vms.mockRejectedValue(new ApiError('Invalid query parameter', 400, 'VALIDATION_ERROR'));
    wrap(<InventoryPage />);
    expect(await screen.findByText('Invalid query parameter')).toBeInTheDocument();
  });
});
