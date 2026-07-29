/**
 * The integrity claim about an object's bytes (I-3).
 *
 * Pure and dependency-free apart from node's crypto: the domain layer may know what SHA-256
 * is, the same way it knows what a string is. It may not know where the bytes came from.
 *
 * ## Why verification is a separate function from computation
 *
 * The tempting shape is one `hash()` and `===` at the call sites. That is how a comparison
 * ends up written as `actual === expected` in one place and `expected === actual` in another
 * with a `?? ""` somewhere in between, at which point a MISSING hash compares equal to a
 * missing hash and the check passes on exactly the rows where nothing was ever recorded.
 * `verifyContentHash` has no way to return "fine" for an absent claim.
 */
import { createHash } from "node:crypto";

const SHA256_HEX = /^[0-9a-f]{64}$/;

export type ContentHash = string;

export function computeContentHash(bytes: Uint8Array): ContentHash {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isContentHash(v: unknown): v is ContentHash {
  return typeof v === "string" && SHA256_HEX.test(v);
}

export class ContentHashMismatchError extends Error {
  constructor(
    readonly objectStorageKey: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    // The key is included and the hashes are not: the hashes say nothing useful to a reader
    // and the key is what an operator needs in order to go look.
    super(`content hash mismatch for ${objectStorageKey}`);
  }
}

/**
 * Recompute and compare. Throws on mismatch rather than returning false.
 *
 * A boolean invites `if (ok) {...}` with no else branch. A mismatch means the bytes behind a
 * version are not the bytes that were pinned -- an object was overwritten despite I-2, or a
 * restore brought back a different generation. Continuing past that is never right, so the
 * signature does not offer it.
 */
export function verifyContentHash(objectStorageKey: string, expected: string, bytes: Uint8Array): void {
  if (!isContentHash(expected)) {
    throw new ContentHashMismatchError(objectStorageKey, "(not a sha-256)", "(unchecked)");
  }
  const actual = computeContentHash(bytes);
  if (actual !== expected) throw new ContentHashMismatchError(objectStorageKey, expected, actual);
}
