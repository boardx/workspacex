import { BoardContentManifestSchema, type BoardContentManifest } from '@repo/contracts/whiteboard-content-manifest';
import { BoardBlobError } from './blob-errors';

export { BoardContentManifestSchema };
export type { BoardContentManifest };

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
  if (manifest.parentManifest && manifest.parentManifest.cipherDigest !== manifest.parentManifestDigest) throw new BoardBlobError('INVALID_INPUT', 'manifest parent pointer digest mismatch');
  if (manifest.parentManifestDigest === null && manifest.parentManifest != null) throw new BoardBlobError('INVALID_INPUT', 'manifest parent pointer has no digest');
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
