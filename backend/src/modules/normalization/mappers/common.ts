/**
 * Tiny building blocks every mapper uses, so identity and lifecycle rules are
 * applied the same way for all five providers (no copy-pasted business logic).
 */
import { IdentityError, type VmIdentity } from '../../../domain/identity.js';
import type { StateMapping } from '../../../domain/state.js';
import type { MapOutcome } from '../types.js';

/** Runs an identity builder; an IdentityError becomes an "invalid" outcome instead of an exception. */
export function identityOrInvalid(
  ref: string | null,
  build: () => VmIdentity,
): { ok: true; identity: VmIdentity } | { ok: false; outcome: MapOutcome } {
  try {
    return { ok: true, identity: build() };
  } catch (err) {
    if (err instanceof IdentityError) return { ok: false, outcome: { kind: 'invalid', ref, errors: [err.message] } };
    throw err;
  }
}

/** Lifecycle/power fields of a NormalizedVm from a provider-state mapping. */
export function stateFields(state: StateMapping) {
  return {
    powerState: state.powerState,
    rawPowerState: state.rawPowerState,
    lifecycle: state.lifecycle,
    decommissionReason: state.lifecycle === 'DECOMMISSIONED' ? state.decommissionReason : null,
  };
}
