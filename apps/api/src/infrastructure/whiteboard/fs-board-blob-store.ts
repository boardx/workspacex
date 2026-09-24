import { constants } from 'node:fs';
import { open, mkdir, link, unlink, lstat, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, BoardBlobError, type BoardBlobPurgeCandidate, type BoardBlobPurgeStore, type BoardBlobStore } from '../../application/whiteboard/blob-ports';
import { assertSha256Digest, assertTenantBlobKey, boardBlobKey, sha256, tenantStorageNamespace } from '../../domain/whiteboard/blob-identity';

function storageFault(action: string, error: unknown): BoardBlobError {
  const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
  return new BoardBlobError('STORAGE_UNAVAILABLE', `${action}: ${code}`);
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

const GC_INDEX_NAME = '.board-gc-candidates-v1';
const GC_INDEX_RECORD_BYTES = 513; // canonical key (<=512 ASCII bytes), space padded, then LF
const GC_SCAN_MULTIPLIER = 4;

// Process-wide rather than instance-local: dependency-injection rebuilds and tests may
// construct multiple adapters for the same root. A target's tail never rejects, so one
// failed publisher cannot poison the next waiter.
const targetPublicationTails = new Map<string, Promise<void>>();
async function withTargetPublication<T>(target: string, publish: () => Promise<T>): Promise<T> {
  const previous = targetPublicationTails.get(target) ?? Promise.resolve();
  let release!: () => void;
  const owned = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => owned);
  targetPublicationTails.set(target, tail);
  await previous;
  try { return await publish(); }
  finally {
    release();
    if (targetPublicationTails.get(target) === tail) targetPublicationTails.delete(target);
  }
}

/**
 * Local single-process adapter for a POSIX root exclusively owned by the service account.
 *
 * The root and every directory created below it must be owned by the current uid and must
 * not be group/world writable. A hostile process running as the same uid is outside this
 * adapter's threat model: it could also read this process's keys and memory. Multi-instance
 * and mutually untrusted deployments must use the object-storage adapter instead.
 */
export class FsBoardBlobStore implements BoardBlobStore, BoardBlobPurgeStore {
  private rootDurabilityBoundary?: string;
  constructor(private readonly root: string, private readonly syncDirectory: (path: string) => Promise<void> = fsyncDirectory) {
    if (!root || !resolve(root)) throw new BoardBlobError('INVALID_INPUT', 'board blob root is required');
  }

  async putImmutable(input: Parameters<BoardBlobStore['putImmutable']>[0]): Promise<'created' | 'already-present-same-content'> {
    this.validateDescriptor(input);
    if (!(input.ciphertext instanceof Uint8Array) || input.ciphertext.byteLength !== input.sizeBytes || sha256(input.ciphertext) !== input.cipherDigest) {
      throw new BoardBlobError('INTEGRITY_FAILED', 'ciphertext does not match its descriptor');
    }
    const target = this.pathFor(input.tenantId, input.key);
    // Persist the candidate intent before publication. A crash can leave an index entry
    // without an object (harmless), but can never leave an unindexed published orphan.
    await this.recordPurgeCandidateIntent(input.tenantId, input.key);
    return withTargetPublication(target, () => this.putAtTarget(input, target));
  }

  private async putAtTarget(input: Parameters<BoardBlobStore['putImmutable']>[0], target: string): Promise<'created' | 'already-present-same-content'> {
    const parent = dirname(target);
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
        await unlink(temporary);
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
        // Publication is process-wide serialized for this absolute target. Therefore any
        // matching temp inode here has no live in-process owner and is a crash residue.
        await this.removeStaleTemporaryLinks(parent, target);
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

  async getVerified(input: Parameters<BoardBlobStore['getVerified']>[0]): Promise<Uint8Array> {
    this.validateDescriptor({ ...input, cipherDigest: input.expectedCipherDigest, sizeBytes: input.expectedSizeBytes, contentType: input.expectedContentType });
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

  async head(input: Parameters<BoardBlobStore['head']>[0]): ReturnType<BoardBlobStore['head']> {
    assertTenantBlobKey(input.tenantId, input.key);
    try {
      const target = this.pathFor(input.tenantId, input.key);
      await this.assertConfinedParent(target);
      const bytes = await this.readRegularNoFollow(target);
      return { cipherDigest: sha256(bytes), sizeBytes: bytes.byteLength, contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE };
    } catch (error) {
      if (error instanceof BoardBlobError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw storageFault(`heading ${input.key}`, error);
    }
  }

  async listPurgeCandidates(input: Parameters<BoardBlobPurgeStore['listPurgeCandidates']>[0]): ReturnType<BoardBlobPurgeStore['listPurgeCandidates']> {
    if (!(input.createdBefore instanceof Date) || !Number.isFinite(input.createdBefore.getTime())
      || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) throw new BoardBlobError('INVALID_INPUT');
    const prefix = `${tenantStorageNamespace(input.tenantId)}/boards/${input.boardId}/`;
    // Validate the board id and the tenant namespace through the canonical key builder.
    boardBlobKey({ tenantId: input.tenantId, boardId: input.boardId, kind: 'manifest', cipherDigest: '0'.repeat(64) });
    const boardRoot = this.pathFor(input.tenantId, prefix.slice(0, -1));
    const indexPath = join(boardRoot, GC_INDEX_NAME);
    const offset = this.decodeIndexCursor(input.cursor);
    const candidates: BoardBlobPurgeCandidate[] = [];
    let handle;
    try {
      await this.assertConfinedDirectory(boardRoot);
      handle = await open(indexPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { candidates: [] };
      if (error instanceof BoardBlobError) throw error;
      throw storageFault('opening Board blob GC candidate index', error);
    }
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size % GC_INDEX_RECORD_BYTES !== 0 || offset > metadata.size) {
        throw new BoardBlobError('INTEGRITY_FAILED', 'invalid Board blob GC candidate index');
      }
      let position = offset, scanned = 0;
      const scanBudget = Math.min(4_000, input.limit * GC_SCAN_MULTIPLIER);
      while (position < metadata.size && scanned < scanBudget && candidates.length < input.limit) {
        const record = Buffer.alloc(GC_INDEX_RECORD_BYTES);
        const read = await handle.read(record, 0, record.byteLength, position);
        if (read.bytesRead !== record.byteLength || record[record.length - 1] !== 0x0a) throw new BoardBlobError('INTEGRITY_FAILED', 'truncated Board blob GC candidate index');
        position += GC_INDEX_RECORD_BYTES; scanned++;
        const key = record.subarray(0, -1).toString('ascii').trimEnd();
        if (!key.startsWith(prefix)) throw new BoardBlobError('INTEGRITY_FAILED', 'cross-Board key in GC candidate index');
        const target = this.pathFor(input.tenantId, key);
        const candidateMetadata = await lstat(target).catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        });
        if (!candidateMetadata) continue;
        if (candidateMetadata.isSymbolicLink() || !candidateMetadata.isFile() || candidateMetadata.nlink !== 1) throw new BoardBlobError('INVALID_INPUT', 'board blob candidate is not a private regular file');
        if (candidateMetadata.mtime.getTime() > input.createdBefore.getTime()) continue;
        const bytes = await this.readRegularNoFollow(target);
        candidates.push({ tenantId: input.tenantId, key, cipherDigest: sha256(bytes), sizeBytes: bytes.byteLength,
          contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, createdAt: candidateMetadata.mtime });
      }
      return { candidates, ...(position < metadata.size ? { nextCursor: this.encodeIndexCursor(position) } : {}) };
    } finally { await handle.close(); }
  }

  async purgeCandidate(input: Parameters<BoardBlobPurgeStore['purgeCandidate']>[0]): ReturnType<BoardBlobPurgeStore['purgeCandidate']> {
    this.validateDescriptor(input);
    if (!(input.createdAt instanceof Date) || !(input.createdBefore instanceof Date)
      || !Number.isFinite(input.createdAt.getTime()) || !Number.isFinite(input.createdBefore.getTime())) throw new BoardBlobError('INVALID_INPUT');
    const target = this.pathFor(input.tenantId, input.key);
    return withTargetPublication(target, async () => {
      try {
        await this.assertConfinedParent(target);
        const metadata = await lstat(target);
        if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) throw new BoardBlobError('INVALID_INPUT', 'board blob candidate is not a private regular file');
        if (metadata.mtime.getTime() !== input.createdAt.getTime() || metadata.mtime.getTime() > input.createdBefore.getTime()) return 'changed-or-too-new';
        const bytes = await this.readRegularNoFollow(target);
        if (bytes.byteLength !== input.sizeBytes || sha256(bytes) !== input.cipherDigest) return 'changed-or-too-new';
        await unlink(target);
        await this.syncDirectory(dirname(target));
        return 'deleted';
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'not-found';
        if (error instanceof BoardBlobError) throw error;
        throw storageFault(`purging ${input.key}`, error);
      }
    });
  }

  private async recordPurgeCandidateIntent(tenantId: string, key: string): Promise<void> {
    const segments = key.split('/');
    if (segments[2] !== 'boards' || !segments[3]) throw new BoardBlobError('INVALID_INPUT');
    const boardRoot = this.pathFor(tenantId, segments.slice(0, 4).join('/'));
    const indexPath = join(boardRoot, GC_INDEX_NAME);
    const keyBytes = Buffer.byteLength(key, 'ascii');
    if (keyBytes > GC_INDEX_RECORD_BYTES - 1) throw new BoardBlobError('INVALID_INPUT');
    const record = Buffer.from(`${key.padEnd(GC_INDEX_RECORD_BYTES - 1, ' ')}\n`, 'ascii');
    try {
      await this.ensureDurableDirectory(boardRoot);
      await withTargetPublication(indexPath, async () => {
        let handle;
        try {
          handle = await open(indexPath, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
          const metadata = await handle.stat();
          if (!metadata.isFile() || metadata.nlink !== 1) throw new BoardBlobError('INVALID_INPUT', 'invalid Board blob GC candidate index');
          if (metadata.size % GC_INDEX_RECORD_BYTES !== 0) await handle.truncate(metadata.size - (metadata.size % GC_INDEX_RECORD_BYTES));
          await handle.writeFile(record); await handle.sync();
        } finally { await handle?.close(); }
        await this.syncDirectory(boardRoot);
      });
    } catch (error) {
      if (error instanceof BoardBlobError) throw error;
      throw storageFault('recording Board blob GC candidate intent', error);
    }
  }

  private decodeIndexCursor(cursor: string | undefined): number {
    if (cursor === undefined) return 0;
    if (!/^v1:[0-9]+$/.test(cursor)) throw new BoardBlobError('INVALID_INPUT');
    const value = Number(cursor.slice(3));
    if (!Number.isSafeInteger(value) || value < 0 || value % GC_INDEX_RECORD_BYTES !== 0) throw new BoardBlobError('INVALID_INPUT');
    return value;
  }

  private encodeIndexCursor(offset: number): string { return `v1:${offset}`; }

  private async assertConfinedDirectory(directory: string): Promise<void> {
    const sentinel = join(directory, 'candidate');
    await this.assertConfinedParent(sentinel);
    await this.assertExclusiveDirectory(directory);
  }

  private validateDescriptor(input: { tenantId: string; key: string; cipherDigest: string; sizeBytes: number; contentType: string }): void {
    assertTenantBlobKey(input.tenantId, input.key);
    assertSha256Digest(input.cipherDigest);
    if (!input.key.endsWith(`/sha256/${input.cipherDigest}`)) throw new BoardBlobError('INVALID_INPUT', 'board blob key does not match its cipher digest');
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) throw new BoardBlobError('INVALID_INPUT', 'invalid board blob size');
    if (input.contentType !== BOARD_ENCRYPTED_BLOB_CONTENT_TYPE) throw new BoardBlobError('INVALID_INPUT', 'invalid encrypted Board blob MIME');
  }

  private pathFor(tenantId: string, key: string): string {
    assertTenantBlobKey(tenantId, key);
    const root = resolve(this.root), path = resolve(join(root, ...key.split('/')));
    if (!path.startsWith(root + sep)) throw new BoardBlobError('INVALID_INPUT', 'board blob key escapes storage root');
    return path;
  }

  private async ensureDurableDirectory(target: string): Promise<void> {
    this.assertSupportedHost();
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
        await this.assertExclusiveDirectory(directory);
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
      await this.assertExclusiveDirectory(directory);
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
        await this.assertExclusiveDirectory(directory);
        if (createdOrRaced) {
          await this.syncDirectory(directory);
          await this.syncDirectory(parent);
        }
        parent = directory;
      }
    }
    await this.assertRealDirectory(boundary);
    if (boundary === root) await this.assertExclusiveDirectory(boundary);
    const relativeRoot = relative(boundary, root);
    if (relativeRoot === '..' || relativeRoot.startsWith(`..${sep}`)) throw new BoardBlobError('INVALID_INPUT', 'board blob root escapes its durability boundary');
    const chain = [boundary];
    let parent = boundary;
    for (const segment of relativeRoot.split(sep).filter(Boolean)) {
      const directory = join(parent, segment);
      try { await this.assertExclusiveDirectory(directory); }
      catch (error) {
        if (error instanceof BoardBlobError || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        try { await mkdir(directory, { mode: 0o700 }); }
        catch (mkdirError) { if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError; }
        await this.assertExclusiveDirectory(directory);
        await this.syncDirectory(directory);
        await this.syncDirectory(parent);
      }
      await this.assertExclusiveDirectory(directory);
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

  private assertSupportedHost(): void {
    void this.currentUid();
  }

  private currentUid(): number {
    const getuid=process.getuid;
    if (process.platform === 'win32' || typeof getuid !== 'function') throw new BoardBlobError('INVALID_INPUT', 'filesystem board blobs require an exclusive POSIX storage root');
    return getuid();
  }

  private async assertExclusiveDirectory(path: string): Promise<void> {
    this.assertSupportedHost();
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new BoardBlobError('INVALID_INPUT', 'board blob storage path is not a real directory');
    if (stat.uid !== this.currentUid() || (stat.mode & 0o022) !== 0) {
      throw new BoardBlobError('INVALID_INPUT', 'board blob storage directory is not exclusively owned');
    }
  }

  private async assertConfinedParent(target: string): Promise<void> {
    const root = resolve(this.root), parent = dirname(target), relativeParent = relative(root, parent);
    if (relativeParent === '..' || relativeParent.startsWith(`..${sep}`)) throw new BoardBlobError('INVALID_INPUT', 'board blob path escapes storage root');
    this.assertSupportedHost();
    await this.assertExclusiveDirectory(root);
    let directory = root;
    for (const segment of relativeParent.split(sep).filter(Boolean)) {
      directory = join(directory, segment);
      await this.assertExclusiveDirectory(directory);
    }
  }

  private async readRegularNoFollow(path: string): Promise<Uint8Array> {
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1) throw new BoardBlobError('INVALID_INPUT', 'board blob target is not a private regular file');
    let handle;
    try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new BoardBlobError('INVALID_INPUT', 'board blob target must not be a symbolic link');
      throw error;
    }
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) throw new BoardBlobError('INVALID_INPUT', 'board blob target changed during validation');
      return new Uint8Array(await handle.readFile());
    } finally { await handle.close(); }
  }

  private async removeStaleTemporaryLinks(parent: string, target: string): Promise<void> {
    const published = await lstat(target);
    if (published.isSymbolicLink() || !published.isFile()) return;
    let removed = false;
    for (const name of await readdir(parent)) {
      if (!name.startsWith('.board-tmp-')) continue;
      const candidate = join(parent, name);
      const stat = await lstat(candidate).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (stat?.isFile() && !stat.isSymbolicLink() && stat.dev === published.dev && stat.ino === published.ino) {
        await unlink(candidate);
        removed = true;
      }
    }
    if (removed) await this.syncDirectory(parent);
  }

}
