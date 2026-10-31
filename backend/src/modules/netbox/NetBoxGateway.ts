/**
 * NetBoxGateway – everything the sync engine needs from NetBox, behind one interface.
 *
 *   SimulatedNetBoxGateway  -> simulated_netbox_vms table (NETBOX_MODE=simulation, default)
 *   HttpNetBoxGateway       -> real NetBox REST API     (NETBOX_MODE=live)
 *
 * Both raise the SAME error classes, so the sync engine behaves identically and the
 * simulation tests exercise the real decision logic.
 */
export type Target = 'NETBOX' | 'SIMULATION';

/** A NetBox virtual machine as CloudVM sees it (subset of virtualization.VirtualMachine). */
export interface NbVm {
  id: number;
  name: string;
  serial: string | null;
  status: string | null;
  cluster: string | null; // cluster name
  vcpus: number | null;
  memory: number | null; // MB
  disk: number | null; // MB
  description: string | null;
  comments: string | null;
  tags: string[]; // tag slugs
}

/** What CloudVM writes. `status` undefined = leave NetBox's value alone. */
export interface NbVmWrite {
  name: string;
  serial: string;
  cluster: string;
  status?: string;
  vcpus: number | null;
  memory: number | null;
  disk: number | null;
  description: string;
  comments: string;
  tags: string[];
}

export interface ClusterSpec {
  name: string; // e.g. "VMWARE/Prod-Cluster-01"
  provider: string; // e.g. "VMWARE" -> cluster type "CloudVM VMWARE"
}

export interface NetBoxGateway {
  readonly target: Target;
  /** Fields this backend cannot store (never diffed). The simulation table has no `comments`. */
  readonly unsupportedFields: ReadonlyArray<keyof NbVmWrite>;
  /** Ensure tags, cluster types and clusters exist (idempotent). */
  prepare(clusters: ClusterSpec[]): Promise<void>;
  getVm(id: number): Promise<NbVm | null>;
  findBySerial(serial: string): Promise<NbVm[]>;
  findByName(name: string, cluster: string): Promise<NbVm | null>;
  createVm(vm: NbVmWrite): Promise<NbVm>;
  updateVm(id: number, patch: Partial<NbVmWrite>): Promise<NbVm>;
}

// ─── Errors (shared by both gateways) ──────────────────────────────────────────
export class NetBoxError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
/** 400 – NetBox rejected the data. Only this VM fails. */
export class NetBoxValidationError extends NetBoxError {}
/** VM name already used in the cluster by another record. */
export class NetBoxNameConflictError extends NetBoxError {}
/** 401/403 – the whole sync run is aborted. */
export class NetBoxAuthError extends NetBoxError {}
/** 429 / 5xx / network / timeout – retried, then the VM fails. */
export class NetBoxTransientError extends NetBoxError {}
