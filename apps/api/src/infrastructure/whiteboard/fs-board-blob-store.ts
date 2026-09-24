import { open, mkdir, link, readFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BoardBlobError, type BoardBlobStore } from '../../application/whiteboard/blob-ports';
import { assertSha256Digest, assertTenantBlobKey, sha256 } from '../../domain/whiteboard/blob-identity';

function storageFault(action: string, error: unknown): BoardBlobError {
  const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
  return new BoardBlobError('STORAGE_UNAVAILABLE', `${action}: ${code}`);
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export class FsBoardBlobStore implements BoardBlobStore {
  constructor(private readonly root: string, private readonly syncParent: (path: string) => Promise<void> = fsyncDirectory) {
    if (!root || !resolve(root)) throw new BoardBlobError('INVALID_INPUT', 'board blob root is required');
  }

  async putImmutable(input: { tenantId: string; key: string; ciphertext: Uint8Array; cipherDigest: string; sizeBytes: number }): Promise<'created' | 'already-present-same-content'> {
    this.validateDescriptor(input);
    if (!(input.ciphertext instanceof Uint8Array) || input.ciphertext.byteLength !== input.sizeBytes || sha256(input.ciphertext) !== input.cipherDigest) {
      throw new BoardBlobError('INTEGRITY_FAILED', 'ciphertext does not match its descriptor');
    }
    const target = this.pathFor(input.tenantId, input.key), parent = dirname(target);
    const temporary = join(parent, `.board-tmp-${process.pid}-${randomUUID()}`);
    try {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(input.ciphertext); await handle.sync(); }
      finally { await handle.close(); }
      try {
        await link(temporary, target);
        await this.syncParent(parent);
        const published = await readFile(target);
        if (published.byteLength !== input.sizeBytes || sha256(published) !== input.cipherDigest) {
          throw new BoardBlobError('INTEGRITY_FAILED', 'published board blob failed read-back verification');
        }
        return 'created';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // The prior publisher may have linked the directory entry and then failed its
        // directory fsync. Replaying identical content is durable only after this attempt
        // repeats the parent sync; EEXIST alone is not a durable-ACK proof.
        await this.syncParent(parent);
        const existing = await readFile(target);
        if (existing.byteLength !== input.sizeBytes || sha256(existing) !== input.cipherDigest) {
          throw new BoardBlobError('CONTENT_CONFLICT', 'immutable board blob key already contains different bytes');
        }
        return 'already-present-same-content';
      }
    } catch (error) {
      if (error instanceof BoardBlobError) throw error;
      throw storageFault(`writing ${input.key}`, error);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async getVerified(input: { tenantId: string; key: string; expectedCipherDigest: string; expectedSizeBytes: number }): Promise<Uint8Array> {
    this.validateDescriptor({ ...input, cipherDigest: input.expectedCipherDigest, sizeBytes: input.expectedSizeBytes });
    try {
      const bytes = new Uint8Array(await readFile(this.pathFor(input.tenantId, input.key)));
      if (bytes.byteLength !== input.expectedSizeBytes || sha256(bytes) !== input.expectedCipherDigest) {
        throw new BoardBlobError('INTEGRITY_FAILED', 'stored board blob failed digest or size verification');
      }
      return bytes;
    } catch (error) {
      if (error instanceof BoardBlobError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BoardBlobError('NOT_FOUND');
      throw storageFault(`reading ${input.key}`, error);
    }
  }

  async head(input: { tenantId: string; key: string }): Promise<{ cipherDigest: string; sizeBytes: number } | null> {
    assertTenantBlobKey(input.tenantId, input.key);
    try {
      const bytes = await readFile(this.pathFor(input.tenantId, input.key));
      return { cipherDigest: sha256(bytes), sizeBytes: bytes.byteLength };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw storageFault(`heading ${input.key}`, error);
    }
  }

  private validateDescriptor(input: { tenantId: string; key: string; cipherDigest: string; sizeBytes: number }): void {
    assertTenantBlobKey(input.tenantId, input.key);
    assertSha256Digest(input.cipherDigest);
    if (!input.key.endsWith(`/sha256/${input.cipherDigest}`)) throw new BoardBlobError('INVALID_INPUT', 'board blob key does not match its cipher digest');
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) throw new BoardBlobError('INVALID_INPUT', 'invalid board blob size');
  }

  private pathFor(tenantId: string, key: string): string {
    assertTenantBlobKey(tenantId, key);
    const root = resolve(this.root), path = resolve(join(root, ...key.split('/')));
    if (!path.startsWith(root + sep)) throw new BoardBlobError('INVALID_INPUT', 'board blob key escapes storage root');
    return path;
  }

}
