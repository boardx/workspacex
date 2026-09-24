import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { sha256 } from './blob-identity';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const bodySchema = z.object({
  version: z.literal(1), tenantId: z.string().min(1).max(256), boardId: z.string().uuid(), jobId: z.string().uuid(),
  manifestDigest: digest, checkpointDigest: digest, pgBackupId: z.string().min(1).max(256), blobBackupId: z.string().min(1).max(256),
  restoreDrillId: z.string().min(1).max(256), verifiedAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict();
export const BoardRetirementCredentialSchema = bodySchema.extend({ signature: digest }).strict();
export type BoardRetirementCredential = z.infer<typeof BoardRetirementCredentialSchema>;
type Body = z.infer<typeof bodySchema>;

function encoded(body: Body): string {
  return JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}
function signature(body: Body, key: Uint8Array): string { return createHmac('sha256', key).update(encoded(body)).digest('hex'); }

export function createBoardRetirementCredential(body: Body, key: Uint8Array): BoardRetirementCredential {
  if (key.byteLength < 32) throw new Error('RETIREMENT_PROOF_KEY_INVALID');
  return { ...bodySchema.parse(body), signature: signature(body, key) };
}

export function boardRetirementProofKey(env: NodeJS.ProcessEnv = process.env): Uint8Array {
  const raw = env.WORKSPACEX_BOARD_RETIREMENT_PROOF_KEY;
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new Error('WORKSPACEX_BOARD_RETIREMENT_PROOF_KEY is required');
  const key = Buffer.from(raw, 'base64');
  if (key.byteLength < 32 || key.toString('base64').replace(/=+$/, '') !== raw.replace(/=+$/, '')) throw new Error('WORKSPACEX_BOARD_RETIREMENT_PROOF_KEY is invalid');
  return key;
}

export function verifyBoardRetirementCredential(input: unknown, expected: { tenantId: string; boardId: string; jobId: string; manifestDigest: string; checkpointDigest: string }, key: Uint8Array, now: Date): { digest: string } {
  if (key.byteLength < 32) throw Object.assign(new Error('RETIREMENT_PROOF_KEY_INVALID'), { code: 'RETIREMENT_PROOF_INVALID' });
  const parsed = BoardRetirementCredentialSchema.safeParse(input);
  if (!parsed.success) throw Object.assign(new Error('RETIREMENT_PROOF_INVALID'), { code: 'RETIREMENT_PROOF_INVALID' });
  const { signature: supplied, ...body } = parsed.data;
  const calculated = signature(body, key);
  if (!timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(calculated, 'hex'))) throw Object.assign(new Error('RETIREMENT_PROOF_INVALID'), { code: 'RETIREMENT_PROOF_INVALID' });
  if (body.tenantId !== expected.tenantId || body.boardId !== expected.boardId || body.jobId !== expected.jobId || body.manifestDigest !== expected.manifestDigest || body.checkpointDigest !== expected.checkpointDigest) {
    throw Object.assign(new Error('RETIREMENT_PROOF_BINDING_MISMATCH'), { code: 'RETIREMENT_PROOF_BINDING_MISMATCH' });
  }
  const verifiedAt = Date.parse(body.verifiedAt), expiresAt = Date.parse(body.expiresAt);
  if (verifiedAt > now.getTime() || expiresAt <= now.getTime() || expiresAt <= verifiedAt) throw Object.assign(new Error('RETIREMENT_PROOF_EXPIRED'), { code: 'RETIREMENT_PROOF_EXPIRED' });
  return { digest: sha256(Buffer.from(JSON.stringify(parsed.data), 'utf8')) };
}
