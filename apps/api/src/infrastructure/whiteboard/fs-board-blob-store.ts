import { constants } from 'node:fs';
import { open, mkdir, link, unlink, lstat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
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
  private rootDurabilityBoundary?: string;
  constructor(private readonly root: string, private readonly syncDirectory: (path: string) => Promise<void> = fsyncDirectory) {
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
      await this.ensureDurableDirectory(parent);
      await this.assertConfinedParent(target);
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(input.ciphertext); await handle.sync(); }
      finally { await handle.close(); }
      try {
        await link(temporary, target);
        await this.syncDirectory(parent);
        const published = await this.readRegularNoFollow(target);
        if (published.byteLength !== input.sizeBytes || sha256(published) !== input.cipherDigest) {
          throw new BoardBlobError('INTEGRITY_FAILED', 'published board blob failed read-back verification');
        }
        return 'created';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // The prior publisher may have linked the directory entry and then failed its
        // directory fsync. Replaying identical content is durable only after this attempt
        // repeats the parent sync; EEXIST alone is not a durable-ACK proof.
        await this.syncDirectory(parent);
        const existing = await this.readRegularNoFollow(target);
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
      const target = this.pathFor(input.tenantId, input.key);
      await this.assertConfinedParent(target);
      const bytes = await this.readRegularNoFollow(target);
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
      const target = this.pathFor(input.tenantId, input.key);
      await this.assertConfinedParent(target);
      const bytes = await this.readRegularNoFollow(target);
      return { cipherDigest: sha256(bytes), sizeBytes: bytes.byteLength };
    } catch (error) {
      if (error instanceof BoardBlobError) throw error;
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

  private async ensureDurableDirectory(target: string): Promise<void> {
    const root = resolve(this.root), relativeTarget = relative(root, target);
    if (relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`) || resolve(target) !== target) {
      throw new BoardBlobError('INVALID_INPUT', 'board blob directory escapes storage root');
    }
    await this.ensureStorageRoot(root);
    const chain = [root];
    let parent = root;
    for (const segment of relativeTarget.split(sep).filter(Boolean)) {
      const directory = join(parent, segment);
      let createdOrRaced = false;
      try {
        await this.assertRealDirectory(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        try { await mkdir(directory, { mode: 0o700 }); createdOrRaced = true; }
        catch (mkdirError) {
          if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError;
          createdOrRaced = true;
        }
        await this.assertRealDirectory(directory);
      }
      if (createdOrRaced) {
        // The new inode must reach disk before the parent directory entry that names it.
        await this.syncDirectory(directory);
        await this.syncDirectory(parent);
      }
      chain.push(directory);
      parent = directory;
    }
    // Repeat the whole chain on every write. This repairs a prior attempt that created a
    // directory and crashed/failed during either fsync before it could return an ACK.
    for (let index = chain.length - 1; index >= 0; index--) await this.syncDirectory(chain[index]!);
    await this.syncDirectory(dirname(root));
  }

  private async ensureStorageRoot(root: string): Promise<void> {
    let boundary = this.rootDurabilityBoundary;
    if (!boundary) {
      const missing: string[] = [];
      let candidate = root;
      for (;;) {
        try { await this.assertRealDirectory(candidate); boundary = candidate; break; }
        catch (error) {
          if (error instanceof BoardBlobError || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          missing.push(candidate);
          const parent = dirname(candidate);
          if (parent === candidate) throw error;
          candidate = parent;
        }
      }
      this.rootDurabilityBoundary = boundary;
      let parent = boundary;
      for (const directory of missing.reverse()) {
        let createdOrRaced = false;
        try { await mkdir(directory, { mode: 0o700 }); createdOrRaced = true; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          createdOrRaced = true;
        }
        await this.assertRealDirectory(directory);
        if (createdOrRaced) {
          await this.syncDirectory(directory);
          await this.syncDirectory(parent);
        }
        parent = directory;
      }
    }
    await this.assertRealDirectory(boundary);
    const relativeRoot = relative(boundary, root);
    if (relativeRoot === '..' || relativeRoot.startsWith(`..${sep}`)) throw new BoardBlobError('INVALID_INPUT', 'board blob root escapes its durability boundary');
    const chain = [boundary];
    let parent = boundary;
    for (const segment of relativeRoot.split(sep).filter(Boolean)) {
      const directory = join(parent, segment);
      try { await this.assertRealDirectory(directory); }
      catch (error) {
        if (error instanceof BoardBlobError || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        try { await mkdir(directory, { mode: 0o700 }); }
        catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError; }
        await this.assertRealDirectory(directory);
        await this.syncDirectory(directory);
        await this.syncDirectory(parent);
      }
      chain.push(directory);
      parent = directory;
    }
    // A prior attempt may have created one or more ancestors and failed before their
    // directory entries became durable. Replaying on the same adapter re-synchronizes the
    // entire original existing-boundary → root chain before any blob can be acknowledged.
    for (let index = chain.length - 1; index >= 0; index--) await this.syncDirectory(chain[index]!);
  }

  private async assertRealDirectory(path: string): Promise<void> {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new BoardBlobError('INVALID_INPUT', 'board blob storage path is not a real directory');
    }
  }

  private async assertConfinedParent(target: string): Promise<void> {
    const root = resolve(this.root), parent = dirname(target), relativeParent = relative(root, parent);
    if (relativeParent === '..' || relativeParent.startsWith(`..${sep}`)) throw new BoardBlobError('INVALID_INPUT', 'board blob path escapes storage root');
    await this.assertRealDirectory(root);
    let directory = root;
    for (const segment of relativeParent.split(sep).filter(Boolean)) {
      directory = join(directory, segment);
      await this.assertRealDirectory(directory);
    }
  }

  private async readRegularNoFollow(path: string): Promise<Uint8Array> {
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isFile()) throw new BoardBlobError('INVALID_INPUT', 'board blob target is not a regular file');
    let handle;
    try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new BoardBlobError('INVALID_INPUT', 'board blob target must not be a symbolic link');
      throw error;
    }
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw new BoardBlobError('INVALID_INPUT', 'board blob target changed during validation');
      return new Uint8Array(await handle.readFile());
    } finally { await handle.close(); }
  }

}
