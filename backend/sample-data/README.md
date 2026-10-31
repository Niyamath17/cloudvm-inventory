# ⚠️ MOCK provider sample data

**Every file in this folder is MOCK DATA.** None of it was collected from a real AWS account,
Azure subscription, Google Cloud project, Proxmox cluster or vCenter server. Account IDs,
subscription IDs, project names, IPs and hostnames are placeholders.

Each file is shaped like the real provider API response (trimmed to the fields CloudVM uses), so
the M2 MOCK adapters exercise the same normalization code a future LIVE adapter would.

| File | Provider | Modelled on | Entries |
|---|---|---|---|
| `aws.ec2.describe-instances.json` | AWS | EC2 `DescribeInstances` + `DescribeInstanceTypes` + `DescribeVolumes` | 14 |
| `azure.compute.virtual-machines.json` | Azure | ARM `Virtual Machines – List All` (+ instanceView), VM sizes, NICs | 12 |
| `gcp.compute.instances-aggregated.json` | GCP | Compute Engine `instances.aggregatedList` + machine types | 12 |
| `proxmox.cluster-resources.json` | Proxmox | `GET /cluster/resources?type=vm` per cluster + QEMU guest agent | 11 (9 VMs + 1 template + 1 LXC container) |
| `vmware.vcenter-vms.json` | VMware | vSphere Automation REST `/api/vcenter/vm` (+ detail, guest identity, tags) | 11 |
| **Total** | | | **60 entries → 58 VMs + 2 skipped** |

## Expected normalization result (M2)
- **58** normalized VMs, **2** skipped (Proxmox template `ubuntu-2204-template`, Proxmox LXC container `nginx-lxc-01`), **0** invalid.
- LXC containers are out of scope for this prototype (they are not virtual machines); supporting them is a possible future enhancement.

## Queried accounts (MOCK stand-in for adapter configuration)
AWS, Azure and GCP files declare the accounts the adapter "queried" in a top-level `accounts` array;
Proxmox has one cluster block per account; VMware has one `vcenter`. An `error` field on an account
(or on a Proxmox cluster block / the VMware file) simulates a failed query in tests.

## Rules
- Every file has a `_meta` block with `"mock": true` and a label starting with `MOCK DATA`.
  Validation (`src/modules/providers/raw/*`) **rejects** a file without it.
- No credentials, keys or tokens – enforced by `tests/unit/sample-data.test.ts`.
- `_meta.edgeCases` lists the deliberate quirks in each file (missing hostnames, memory in
  MiB/MB/bytes, unusual power states, duplicate names, repeated Proxmox VMIDs, a template, …).
