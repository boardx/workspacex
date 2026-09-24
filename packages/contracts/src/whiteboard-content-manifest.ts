import { z } from 'zod';

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const BlobKey = z.string().min(1).max(512).regex(/^[a-z0-9][a-z0-9/_-]*$/)
  .refine(value => !value.includes('//') && !value.split('/').some(part => part === '.' || part === '..'));
const Seq = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const Common = z.object({
  key: BlobKey,
  plainDigest: Digest,
  cipherDigest: Digest,
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

/** Versioned logical shape; canonical bytes and continuity are Board domain concerns. */
export const BoardContentManifestSchema = z.object({
  manifestVersion: z.literal(1),
  boardId: z.string().uuid(),
  epoch: z.number().int().positive().max(2_147_483_647),
  headSeq: Seq,
  schemaVersion: z.number().int().positive().max(2_147_483_647),
  checkpoint: Common.extend({ throughSeq: Seq }),
  tail: z.array(Common.extend({
    fromSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    throughSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })).max(100_000),
  parentManifestDigest: Digest.nullable(),
  /** Full pointer permits retention traversal. Older v1 manifests omit it and GC fails closed. */
  parentManifest: Common.extend({ tenantKeyVersion: z.number().int().positive().max(2_147_483_647) }).nullable().optional(),
  tenantKeyVersion: z.number().int().positive().max(2_147_483_647),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export type BoardContentManifest = z.infer<typeof BoardContentManifestSchema>;
