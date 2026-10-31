/**
 * Read-only view of NetBox used by drift reporting (M5).
 * Kept separate from NetBoxGateway so the verified M4 sync interface is unchanged.
 */
import type { NbVm, Target } from './NetBoxGateway.js';

export interface NetBoxReader {
  readonly target: Target;
  /** Every VM record in the target (simulated table, or all NetBox VMs). */
  listVms(): Promise<NbVm[]>;
}
