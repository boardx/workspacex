/**
 * `ObjectIntegrityChecker` over the real `ObjectStore` (F34, V8·22-1).
 *
 * Reuses the domain's `computeContentHash` (phase-00 I-3) rather than re-implementing SHA-256
 * here -- the claim being checked ("the bytes at this key hash to this value") is exactly the
 * one `content-hash.ts` already states, and a second hashing routine would be the same
 * invariant declared in two places for no reason.
 *
 * ⚠ This reads the FULL object into memory to hash it. That is acceptable at the granularity
 * this is called from -- once per `issueDownloadUrl`, a single-file action a human just
 * triggered -- and would NOT be acceptable run once per row for a 5000-artifact list (R9's
 * P95 < 1.5s budget). Nothing here is wired into `listProjectArtifacts`; see
 * `deliver-artifact.ts`'s header for why the list stays metadata-only.
 */
import { computeContentHash } from "../../domain/artifact/content-hash";
import type { ObjectStore } from "../../application/artifact/ports";
import type { IntegrityResult, ObjectIntegrityChecker } from "../../application/files/ports";

export class ObjectStoreIntegrityChecker implements ObjectIntegrityChecker {
  constructor(private readonly store: ObjectStore) {}

  async verify(objectKey: string, expectedSha256: string): Promise<IntegrityResult> {
    const bytes = await this.store.get(objectKey);
    // Missing bytes are an integrity failure too -- a version row that claims a hash but has
    // nothing behind it is exactly the "幽灵节点" AC2 forbids, and it must not be reported to
    // the caller as `ok`.
    if (bytes === null) return "object-missing";
    return computeContentHash(bytes) === expectedSha256 ? "ok" : "hash-mismatch";
  }
}
