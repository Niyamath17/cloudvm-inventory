/** Types mirroring the backend REST responses (backend/src/modules/*). */
export type Provider = 'AWS' | 'AZURE' | 'GCP' | 'PROXMOX' | 'VMWARE';
export type PowerState = 'RUNNING' | 'STOPPED' | 'SUSPENDED' | 'UNKNOWN';
export type Lifecycle = 'ACTIVE' | 'DECOMMISSIONED';
export type RunStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
export type SyncTarget = 'NETBOX' | 'SIMULATION';
export type DriftType = 'MISSING_IN_NETBOX' | 'ORPHAN_IN_NETBOX' | 'RESOURCE_MISMATCH' | 'POWER_STATE_MISMATCH' | 'DUPLICATE';
export type DriftSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface Paged<T> {
  data: T[];
  pagination: Pagination;
}

export interface Vm {
  id: string;
  provider: Provider;
  externalId: string;
  nativeId: string;
  account: string;
  name: string;
  hostname: string | null;
  ipAddresses: string[];
  osName: string | null;
  cpuCores: number | null;
  memoryMb: number | null; // MiB
  diskGb: number | null; // GiB
  region: string | null;
  cluster: string | null;
  powerState: PowerState;
  rawPowerState: string | null;
  owner: string | null;
  tags: Record<string, string>;
  dataSource: 'MOCK' | 'LIVE';
  lifecycle: Lifecycle;
  decommissionedAt: string | null;
  decommissionReason: string | null;
  firstDiscoveredAt: string;
  lastDiscoveredAt: string;
}

export interface VmSyncStateDto {
  target: SyncTarget;
  state: 'PENDING' | 'SYNCED' | 'FAILED' | 'DUPLICATE';
  netboxId: number | null;
  simulatedVmId: number | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}
export interface SyncEventDto {
  id: string;
  syncRunId: string;
  vmId: string | null;
  vmName: string;
  action: 'CREATE' | 'UPDATE' | 'DECOMMISSION' | 'SKIP';
  success: boolean;
  remoteId: number | null;
  httpStatus: number | null;
  error: string | null;
  diff: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
}
export interface VmDetail extends Vm {
  rawData: unknown;
  syncStates: VmSyncStateDto[];
  syncEvents: SyncEventDto[];
}

export interface Facets {
  providers: Array<{ value: Provider; count: number }>;
  powerStates: Array<{ value: PowerState; count: number }>;
  lifecycles: Array<{ value: Lifecycle; count: number }>;
  regions: string[];
  clusters: string[];
  owners: string[];
}

export interface DashboardSummary {
  dataSource: 'MOCK' | 'LIVE';
  vms: { total: number; active: number; running: number; stopped: number; suspended: number; unknown: number; decommissioned: number };
  resources: { cpuCores: number; memoryMb: number; diskGb: number };
  providers: Array<{ provider: Provider; vms: number; cpuCores: number; memoryMb: number; diskGb: number }>;
  lastCollection: { id: string; status: RunStatus; trigger: string; startedAt: string; finishedAt: string | null } | null;
  lastSync: (SyncRunDto & { simulated: boolean }) | null;
}

export interface ProviderRunResultDto {
  id: string;
  provider: Provider;
  dataSource: 'MOCK' | 'LIVE';
  status: RunStatus;
  vmCount: number;
  invalidCount: number;
  durationMs: number;
  error: string | null;
}
export interface CollectionRunDto {
  id: string;
  trigger: 'MANUAL' | 'SCHEDULED';
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  discoveredCount: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  decommissionedCount: number;
  invalidCount: number;
  errors: Array<{ provider: string; ref?: string | null; stage?: string; message: string }>;
  providerResults: ProviderRunResultDto[];
}

export interface SyncRunDto {
  id: string;
  target: SyncTarget;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  createdCount: number;
  updatedCount: number;
  decommissionedCount: number;
  skippedCount: number;
  failedCount: number;
  duplicateCount: number;
  error?: string | null;
}
export interface SyncRunDetail extends SyncRunDto {
  label: string;
  events: SyncEventDto[];
}

export interface NetBoxStatus {
  mode: 'SIMULATION' | 'LIVE';
  target: SyncTarget;
  label: string;
  simulatedRecords?: number;
  reachable?: boolean;
  netboxVersion?: string;
}

export interface DriftItemDto {
  id: string;
  type: DriftType;
  severity: DriftSeverity;
  vmId: string | null;
  remoteId: number | null;
  name: string;
  field: string | null;
  expected: string | null;
  actual: string | null;
}
export interface DriftSummaryDto {
  totalItems: number;
  byType: Record<DriftType, number>;
  bySeverity: Record<DriftSeverity, number>;
  comparedLocal: number;
  comparedRemote: number;
}
export interface DriftReportDto {
  id: string;
  target: SyncTarget;
  generatedAt: string;
  totalItems: number;
  summary: DriftSummaryDto;
  label: string;
}
export interface DriftReportDetail extends DriftReportDto {
  items: DriftItemDto[];
}
