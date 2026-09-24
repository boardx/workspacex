import { z } from 'zod';

const Digest = z.string().regex(/^[a-f0-9]{64}$/);

/** Object-bound proof that both PG and Blob backups passed a restore drill. */
export const BoardRetirementCredentialBodySchema = z.object({
  version: z.literal(1),
  tenantId: z.string().min(1).max(256),
  boardId: z.string().uuid(),
  jobId: z.string().uuid(),
  manifestDigest: Digest,
  checkpointDigest: Digest,
  pgBackupId: z.string().min(1).max(256),
  blobBackupId: z.string().min(1).max(256),
  restoreDrillId: z.string().min(1).max(256),
  verifiedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();

export const BoardRetirementCredentialSchema = BoardRetirementCredentialBodySchema.extend({
  signature: Digest,
}).strict();

export type BoardRetirementCredentialBody = z.infer<typeof BoardRetirementCredentialBodySchema>;
export type BoardRetirementCredential = z.infer<typeof BoardRetirementCredentialSchema>;
