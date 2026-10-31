/** One function per backend endpoint used by the UI. */
import { api, toApiError } from './client';
import type {
  CollectionRunDto,
  DashboardSummary,
  DriftReportDetail,
  DriftReportDto,
  Facets,
  NetBoxStatus,
  Paged,
  SyncRunDetail,
  SyncRunDto,
  VmDetail,
  Vm,
} from './types';

async function call<T>(p: Promise<{ data: T }>): Promise<T> {
  try {
    return (await p).data;
  } catch (err) {
    throw toApiError(err);
  }
}

export interface VmQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  provider?: string[];
  powerState?: string[];
  lifecycle?: 'ACTIVE' | 'DECOMMISSIONED' | 'ALL';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const endpoints = {
  dashboard: () => call<DashboardSummary>(api.get('/dashboard/summary')),
  netboxStatus: () => call<NetBoxStatus>(api.get('/netbox/status')),

  vms: (q: VmQuery) =>
    call<Paged<Vm>>(
      api.get('/vms', {
        params: {
          ...q,
          search: q.search || undefined,
          provider: q.provider?.length ? q.provider.join(',') : undefined,
          powerState: q.powerState?.length ? q.powerState.join(',') : undefined,
        },
      }),
    ),
  vm: (id: string) => call<VmDetail>(api.get(`/vms/${id}`)),
  facets: () => call<Facets>(api.get('/vms/facets')),

  collections: (page = 1, pageSize = 10) => call<Paged<CollectionRunDto>>(api.get('/collections', { params: { page, pageSize } })),
  collection: (id: string) => call<CollectionRunDto>(api.get(`/collections/${id}`)),
  startCollection: () => call<{ runId: string }>(api.post('/collections')),

  syncRuns: (page = 1, pageSize = 10) => call<Paged<SyncRunDto>>(api.get('/sync/runs', { params: { page, pageSize } })),
  syncRun: (id: string) => call<SyncRunDetail>(api.get(`/sync/runs/${id}`)),
  startSync: () => call<{ syncRunId: string; target: string; label: string }>(api.post('/sync')),

  latestDrift: async (): Promise<DriftReportDetail | null> => {
    try {
      return await call<DriftReportDetail>(api.get('/drift/reports/latest'));
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as { status: number | null }).status === 404) return null;
      throw err;
    }
  },
  driftReport: (id: string) => call<DriftReportDetail>(api.get(`/drift/reports/${id}`)),
  driftReports: (page = 1, pageSize = 10) => call<Paged<DriftReportDto>>(api.get('/drift/reports', { params: { page, pageSize } })),
  generateDrift: () => call<DriftReportDto>(api.post('/drift/reports')),
  remediateDrift: (id: string) => call<{ markedForResync: number; manualActionRequired: number; next: string }>(api.post(`/drift/reports/${id}/remediate`)),
};
