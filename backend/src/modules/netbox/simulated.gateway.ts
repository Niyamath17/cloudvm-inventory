/**
 * SIMULATION ONLY – a NetBox stand-in backed by the simulated_netbox_vms table.
 *
 * Mirrors NetBox's rules that matter for sync: integer IDs, VM name unique per cluster
 * (DB unique constraint -> NetBoxNameConflictError), serial NOT unique. Nothing here
 * contacts a real NetBox, and every sync run that uses it is recorded as target SIMULATION.
 */
import { Prisma, type PrismaClient, type SimulatedNetboxVm } from '@prisma/client';
import {
  NetBoxNameConflictError,
  NetBoxValidationError,
  type ClusterSpec,
  type NbVm,
  type NbVmWrite,
  type NetBoxGateway,
} from './NetBoxGateway.js';
import type { NetBoxReader } from './NetBoxReader.js';

const toNbVm = (r: SimulatedNetboxVm): NbVm => ({
  id: r.id,
  name: r.name,
  serial: r.serial,
  status: r.status,
  cluster: r.clusterName,
  vcpus: r.vcpus,
  memory: r.memory,
  disk: r.disk,
  description: r.description,
  comments: null, // the simulation table has no comments column; comments are not compared
  tags: r.tags,
});

function translate(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new NetBoxNameConflictError('virtual machine with this name already exists in the cluster (simulated NetBox)', 400);
  }
  if (err instanceof Prisma.PrismaClientValidationError) throw new NetBoxValidationError(err.message, 400);
  throw err;
}

export class SimulatedNetBoxGateway implements NetBoxGateway, NetBoxReader {
  readonly target = 'SIMULATION' as const;
  readonly unsupportedFields = ['comments'] as const;

  constructor(private readonly prisma: PrismaClient) {}

  async prepare(_clusters: ClusterSpec[]): Promise<void> {
    // Clusters, cluster types and tags are plain strings in the simulation – nothing to create.
  }

  async listVms(): Promise<NbVm[]> {
    return (await this.prisma.simulatedNetboxVm.findMany({ orderBy: { id: 'asc' } })).map(toNbVm);
  }

  async getVm(id: number): Promise<NbVm | null> {
    const r = await this.prisma.simulatedNetboxVm.findUnique({ where: { id } });
    return r ? toNbVm(r) : null;
  }

  async findBySerial(serial: string): Promise<NbVm[]> {
    return (await this.prisma.simulatedNetboxVm.findMany({ where: { serial }, orderBy: { id: 'asc' } })).map(toNbVm);
  }

  async findByName(name: string, cluster: string): Promise<NbVm | null> {
    const r = await this.prisma.simulatedNetboxVm.findUnique({ where: { clusterName_name: { clusterName: cluster, name } } });
    return r ? toNbVm(r) : null;
  }

  async createVm(vm: NbVmWrite): Promise<NbVm> {
    try {
      const r = await this.prisma.simulatedNetboxVm.create({
        data: {
          name: vm.name,
          clusterName: vm.cluster,
          serial: vm.serial,
          status: vm.status ?? 'active', // NetBox's default status
          vcpus: vm.vcpus,
          memory: vm.memory,
          disk: vm.disk,
          tags: vm.tags,
          description: vm.description,
        },
      });
      return toNbVm(r);
    } catch (err) {
      translate(err);
    }
  }

  async updateVm(id: number, patch: Partial<NbVmWrite>): Promise<NbVm> {
    try {
      const r = await this.prisma.simulatedNetboxVm.update({
        where: { id },
        data: {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.cluster !== undefined && { clusterName: patch.cluster }),
          ...(patch.serial !== undefined && { serial: patch.serial }),
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.vcpus !== undefined && { vcpus: patch.vcpus }),
          ...(patch.memory !== undefined && { memory: patch.memory }),
          ...(patch.disk !== undefined && { disk: patch.disk }),
          ...(patch.tags !== undefined && { tags: patch.tags }),
          ...(patch.description !== undefined && { description: patch.description }),
        },
      });
      return toNbVm(r);
    } catch (err) {
      translate(err);
    }
  }
}
