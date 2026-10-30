import { describe, expect, it } from 'vitest';
import { mapProviderState } from '../../src/domain/state.js';

describe('mapProviderState – lifecycle vs power state', () => {
  it('AWS terminated -> DECOMMISSIONED (PROVIDER_TERMINATED), power UNKNOWN, raw value kept', () => {
    expect(mapProviderState('AWS', 'terminated')).toEqual({
      lifecycle: 'DECOMMISSIONED',
      powerState: 'UNKNOWN',
      decommissionReason: 'PROVIDER_TERMINATED',
      rawPowerState: 'terminated',
    });
  });

  it('AWS shutting-down (termination in progress) is also decommissioned', () => {
    expect(mapProviderState('AWS', 'shutting-down').lifecycle).toBe('DECOMMISSIONED');
  });

  it('AWS stopped is an ACTIVE, STOPPED VM – never confused with terminated', () => {
    expect(mapProviderState('AWS', 'stopped')).toEqual({ lifecycle: 'ACTIVE', powerState: 'STOPPED', rawPowerState: 'stopped' });
    expect(mapProviderState('AWS', 'stopping').powerState).toBe('STOPPED');
  });

  it('a terminated VM is never reported as STOPPED', () => {
    expect(mapProviderState('AWS', 'terminated').powerState).not.toBe('STOPPED');
  });

  it('GCP TERMINATED means stopped, not deleted', () => {
    expect(mapProviderState('GCP', 'TERMINATED')).toEqual({ lifecycle: 'ACTIVE', powerState: 'STOPPED', rawPowerState: 'TERMINATED' });
  });

  it('Azure deallocated is stopped and still exists', () => {
    expect(mapProviderState('AZURE', 'PowerState/deallocated')).toEqual({
      lifecycle: 'ACTIVE',
      powerState: 'STOPPED',
      rawPowerState: 'PowerState/deallocated',
    });
  });

  it('unknown or missing states become UNKNOWN, never a guess', () => {
    expect(mapProviderState('GCP', 'REPAIRING')).toMatchObject({ lifecycle: 'ACTIVE', powerState: 'UNKNOWN' });
    expect(mapProviderState('PROXMOX', 'unknown')).toMatchObject({ powerState: 'UNKNOWN' });
    expect(mapProviderState('AZURE', undefined)).toEqual({ lifecycle: 'ACTIVE', powerState: 'UNKNOWN', rawPowerState: null });
  });

  it('VMware and Proxmox map their own vocabularies', () => {
    expect(mapProviderState('VMWARE', 'SUSPENDED').powerState).toBe('SUSPENDED');
    expect(mapProviderState('VMWARE', 'POWERED_OFF').powerState).toBe('STOPPED');
    expect(mapProviderState('PROXMOX', 'running').powerState).toBe('RUNNING');
  });
});
