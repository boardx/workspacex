import { z } from 'zod';
import { BoardBlobError } from './blob-errors';

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const BlobKey = z.string().min(1).max(512).regex(/^[a-z0-9][a-z0-9/_-]*$/).refine(value => !value.includes('//') && !value.split('/').some(part => part === '.' || part === '..'));
const Seq = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const Common = z.object({
  key: BlobKey,
  plainDigest: Digest,
  cipherDigest: Digest,
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export const BoardContentManifestSchema = z.object({
  manifestVersion: z.literal(1),
  boardId: z.string().uuid(),
  epoch: z.number().int().positive().max(2_147_483_647),
  headSeq: Seq,
  schemaVersion: z.number().int().positive().max(2_147_483_647),
  checkpoint: Common.extend({ throughSeq: Seq }),
  tail: z.array(Common.extend({ fromSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), throughSeq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })).max(100_000),
  parentManifestDigest: Digest.nullable(),
  tenantKeyVersion: z.number().int().positive().max(2_147_483_647),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export type BoardContentManifest = z.infer<typeof BoardContentManifestSchema>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    // The v1 byte contract orders every object level by ECMAScript's ordinal
    // UTF-16 code-unit comparison. Locale collation is forbidden because the
    // same manifest must hash identically on every hosted/self-hosted runtime.
    const entries = Object.entries(value).sort(([left], [right]) => left === right ? 0 : left < right ? -1 : 1);
    return Object.fromEntries(entries.map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function validateBoardContentManifest(input: unknown): BoardContentManifest {
  const parsed = BoardContentManifestSchema.safeParse(input);
  if (!parsed.success) throw new BoardBlobError('INVALID_INPUT', 'invalid board manifest');
  const manifest = parsed.data;
  if (manifest.checkpoint.throughSeq > manifest.headSeq) throw new BoardBlobError('INVALID_INPUT', 'checkpoint exceeds manifest head');
  let through = manifest.checkpoint.throughSeq;
  for (const segment of manifest.tail) {
    if (segment.fromSeq !== through + 1 || segment.throughSeq < segment.fromSeq || segment.throughSeq > manifest.headSeq) {
      throw new BoardBlobError('INVALID_INPUT', 'manifest tail is not contiguous');
    }
    through = segment.throughSeq;
  }
  if (through !== manifest.headSeq) throw new BoardBlobError('INVALID_INPUT', 'manifest does not reach its head');
  return manifest;
}

export function encodeBoardContentManifest(input: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(canonical(validateBoardContentManifest(input))), 'utf8');
}

export function decodeBoardContentManifest(bytes: Uint8Array): BoardContentManifest {
  let input: unknown;
  try { input = JSON.parse(Buffer.from(bytes).toString('utf8')); }
  catch { throw new BoardBlobError('INVALID_INPUT', 'manifest is not valid JSON'); }
  return validateBoardContentManifest(input);
}
