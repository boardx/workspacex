import { BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, type BoardBlobCodec, type BoardBlobPurgeCandidate, type BoardBlobPurgeStore, type BoardBlobStore } from './blob-ports';
import { boardBlobKey, sha256 } from '../../domain/whiteboard/blob-identity';
import { decodeBoardContentManifest } from '../../domain/whiteboard/content-manifest';

export interface BoardManifestRoot {
  key: string;
  cipherDigest: string;
  plainDigest: string;
  sizeBytes: number;
  tenantKeyVersion: number;
}

/** The callback runs while the repository holds the same Board row lock as writers. */
export interface BoardBlobReferenceGuard {
  withLockedManifestRoots<T>(input: { tenantId: string; boardId: string }, inspect: (roots: readonly BoardManifestRoot[]) => Promise<T>): Promise<T>;
}
export const BOARD_BLOB_REFERENCE_GUARD = Symbol('BoardBlobReferenceGuard');

export interface BoardBlobSweepResult {
  examined: number;
  deleted: number;
  retained: number;
  changed: number;
  nextCursor?: string;
}

/**
 * Mark-and-sweep for one Board. Listing happens before locking, but reference traversal,
 * the final mark check and physical purge all happen under the Board write lock. This
 * closes the retry-vs-GC race: a writer cannot publish blobs and commit a new root while
 * the sweeper is deciding that the same keys are unreachable.
 */
export class SweepBoardBlobs {
  constructor(
    private readonly blobs: BoardBlobStore,
    private readonly purge: BoardBlobPurgeStore,
    private readonly codec: BoardBlobCodec,
    private readonly references: BoardBlobReferenceGuard,
  ) {}

  async run(input: { tenantId: string; boardId: string; createdBefore: Date; limit: number; cursor?: string }): Promise<BoardBlobSweepResult> {
    const page = await this.purge.listPurgeCandidates(input);
    return this.references.withLockedManifestRoots(input, async roots => {
      const marked = new Set<string>();
      for (const root of roots) await this.markManifestChain(input.tenantId, input.boardId, root, marked);
      let deleted = 0, retained = 0, changed = 0;
      for (const candidate of page.candidates) {
        if (marked.has(candidate.key)) { retained++; continue; }
        const result = await this.purge.purgeCandidate({ ...candidate, createdBefore: input.createdBefore });
        if (result === 'deleted') deleted++;
        else changed++;
      }
      return { examined: page.candidates.length, deleted, retained, changed, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
    });
  }

  private async markManifestChain(tenantId: string, boardId: string, root: BoardManifestRoot, marked: Set<string>): Promise<void> {
    let current: BoardManifestRoot | null = root;
    while (current) {
      if (marked.has(current.key)) return;
      marked.add(current.key);
      const encrypted = await this.blobs.getVerified({ tenantId, key: current.key, expectedCipherDigest: current.cipherDigest, expectedSizeBytes: current.sizeBytes, expectedContentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE });
      const bytes = await this.codec.decrypt({ ...current, ciphertext: encrypted, contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, tenantId, expectedPlainDigest: current.plainDigest });
      const manifest = decodeBoardContentManifest(bytes);
      if (manifest.boardId !== boardId || sha256(bytes) !== current.plainDigest) throw new Error('BOARD_BLOB_GC_MANIFEST_MISMATCH');
      marked.add(manifest.checkpoint.key);
      for (const tail of manifest.tail) marked.add(tail.key);
      if (!manifest.parentManifestDigest) return;
      // Old v1 manifests carried only the parent digest. Their transitive history cannot be
      // proven, so fail closed rather than risk deleting a retained checkpoint.
      if (!manifest.parentManifest) throw new Error('BOARD_BLOB_GC_LEGACY_HISTORY_UNVERIFIABLE');
      if (manifest.parentManifest.cipherDigest !== manifest.parentManifestDigest
        || manifest.parentManifest.key !== boardBlobKey({ tenantId, boardId, kind: 'manifest', cipherDigest: manifest.parentManifestDigest })) {
        throw new Error('BOARD_BLOB_GC_PARENT_POINTER_MISMATCH');
      }
      current = manifest.parentManifest;
    }
  }
}

export function isSamePurgeCandidate(left: BoardBlobPurgeCandidate, right: BoardBlobPurgeCandidate): boolean {
  return left.tenantId === right.tenantId && left.key === right.key && left.cipherDigest === right.cipherDigest
    && left.sizeBytes === right.sizeBytes && left.contentType === right.contentType && left.createdAt.getTime() === right.createdAt.getTime();
}
