/**
 * `_meta` block that every MOCK sample file must carry.
 *
 * `mock: z.literal(true)` makes it impossible to load a sample file that is not
 * explicitly marked as mock data – the honesty rule is enforced by validation,
 * not just by convention.
 */
import { z } from 'zod';

export const mockMetaSchema = z.object({
  mock: z.literal(true),
  label: z.string().regex(/^MOCK DATA/, 'label must start with "MOCK DATA"'),
  provider: z.enum(['AWS', 'AZURE', 'GCP', 'PROXMOX', 'VMWARE']),
  shape: z.string().min(1),
  scope: z.record(z.string(), z.unknown()),
  generatedOn: z.string(),
  edgeCases: z.array(z.string()),
});

export type MockMeta = z.infer<typeof mockMetaSchema>;
