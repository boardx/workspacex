import {
  BOARD_ENCRYPTED_BLOB_CONTENT_TYPE,
  BoardBlobError,
  type BoardBlobDescriptor,
  type BoardBlobIdentity,
  type BoardBlobPurgeStore,
  type BoardBlobStore,
} from '../../application/whiteboard/blob-ports';
import { assertSha256Digest, assertTenantBlobKey, boardBlobKey, sha256, tenantStorageNamespace } from '../../domain/whiteboard/blob-identity';

export interface HostedBoardBucketPolicy {
  access: 'private' | 'public' | 'unknown';
  versioning: 'enabled' | 'disabled' | 'unsupported' | 'unknown';
  objectLock: 'enabled' | 'disabled' | 'unsupported' | 'unknown';
}

export interface HostedBoardBlobObject {
  bytes: Uint8Array;
  cipherDigest?: string;
  sizeBytes?: number;
  versionId?: string;
  contentType?: string;
  createdAt?: Date;
}

export interface HostedBoardListedObject {
  key: string;
  sizeBytes?: number;
  createdAt?: Date;
}

export type HostedBoardPutResult = 'created' | 'already-exists';

/**
 * A deliberately small, provider-neutral protocol. Implementations own credential refresh and
 * translate provider failures to these stable outcomes without leaking request details or secrets.
 */
export interface HostedBoardBlobClient {
  readonly provider: 'aliyun-oss' | 's3-compatible';
  readonly profile?: 'aws-s3' | 'minio' | 'r2';
  inspectBucket(): Promise<HostedBoardBucketPolicy>;
  putIfAbsent(input: {
    key: string;
    bytes: Uint8Array;
    contentType: 'application/octet-stream';
    metadata: { cipherDigest: string; sizeBytes: number };
  }): Promise<HostedBoardPutResult>;
  get(key: string): Promise<HostedBoardBlobObject | null>;
  head(key: string): Promise<Omit<HostedBoardBlobObject, 'bytes'> | null>;
  list(input: { keyPrefix: string; limit: number; cursor?: string }): Promise<{ objects: HostedBoardListedObject[]; nextCursor?: string }>;
  deleteCurrent(key: string, versionId?: string): Promise<'deleted' | 'not-found'>;
}

export interface HostedBoardBlobPolicyRequirement {
  requireObjectLock: boolean;
}

function unavailable(): BoardBlobError {
  return new BoardBlobError('STORAGE_UNAVAILABLE', 'hosted board storage is unavailable');
}

function integrity(): BoardBlobError {
  return new BoardBlobError('INTEGRITY_FAILED', 'hosted board blob failed verification');
}

export class HostedBoardBlobStore implements BoardBlobStore, BoardBlobPurgeStore {
  constructor(
    private readonly client: HostedBoardBlobClient,
    private readonly requirement: HostedBoardBlobPolicyRequirement,
  ) {}

  async assertReady(): Promise<void> {
    let policy: HostedBoardBucketPolicy;
    try { policy = await this.client.inspectBucket(); }
    catch { throw unavailable(); }
    const versioningCompatible = policy.versioning === 'enabled'
      || this.client.profile === 'r2' && policy.versioning === 'unsupported';
    if (policy.access !== 'private' || !versioningCompatible
      || (this.requirement.requireObjectLock && policy.objectLock !== 'enabled')) {
      throw new BoardBlobError('STORAGE_UNAVAILABLE', 'hosted board bucket policy is incompatible');
    }
  }

  async putImmutable(input: BoardBlobIdentity & BoardBlobDescriptor & { ciphertext: Uint8Array }): Promise<'created' | 'already-present-same-content'> {
    this.validateWrite(input);
    // Snapshot caller-owned bytes before the first await.
    const bytes = new Uint8Array(input.ciphertext);
    await this.assertReady();
    let result: HostedBoardPutResult;
    try {
      result = await this.client.putIfAbsent({
        key: input.key,
        bytes,
        contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE,
        metadata: { cipherDigest: input.cipherDigest, sizeBytes: input.sizeBytes },
      });
    } catch {
      // A timed-out conditional PUT may have committed. Resolve the ambiguous outcome by readback.
      const recovered = await this.tryVerified(input);
      if (recovered) return 'already-present-same-content';
      // One bounded retry is safe because the provider precondition remains in force. It also gives
      // SDK clients one opportunity to refresh short-lived credentials.
      await this.assertReady();
      try {
        result = await this.client.putIfAbsent({
          key: input.key,
          bytes,
          contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE,
          metadata: { cipherDigest: input.cipherDigest, sizeBytes: input.sizeBytes },
        });
      } catch {
        if (await this.tryVerified(input)) return 'already-present-same-content';
        throw unavailable();
      }
    }
    try {
      await this.getVerified({
        tenantId: input.tenantId,
        key: input.key,
        expectedCipherDigest: input.cipherDigest,
        expectedSizeBytes: input.sizeBytes,
        expectedContentType: input.contentType,
      });
    } catch (error) {
      if (result === 'already-exists' && error instanceof BoardBlobError
        && (error.code === 'INTEGRITY_FAILED' || error.code === 'NOT_FOUND')) {
        throw new BoardBlobError('CONTENT_CONFLICT', 'immutable board blob key already contains different bytes');
      }
      throw error;
    }
    return result === 'created' ? 'created' : 'already-present-same-content';
  }

  async getVerified(input: Parameters<BoardBlobStore['getVerified']>[0]): Promise<Uint8Array> {
    this.validateRead(input);
    await this.assertReady();
    let object: HostedBoardBlobObject | null;
    try { object = await this.client.get(input.key); }
    catch { throw unavailable(); }
    if (!object) throw new BoardBlobError('NOT_FOUND');
    const bytes = new Uint8Array(object.bytes);
    if (bytes.byteLength !== input.expectedSizeBytes || sha256(bytes) !== input.expectedCipherDigest
      || object.sizeBytes !== undefined && object.sizeBytes !== input.expectedSizeBytes
      || object.cipherDigest !== undefined && object.cipherDigest !== input.expectedCipherDigest
      || object.contentType !== input.expectedContentType) throw integrity();
    return bytes;
  }

  async head(input: BoardBlobIdentity): Promise<BoardBlobDescriptor | null> {
    assertTenantBlobKey(input.tenantId, input.key);
    await this.assertReady();
    let object: Omit<HostedBoardBlobObject, 'bytes'> | null;
    try { object = await this.client.head(input.key); }
    catch { throw unavailable(); }
    if (!object) return null;
    if (object.cipherDigest === undefined || object.sizeBytes === undefined) throw integrity();
    try { assertSha256Digest(object.cipherDigest); }
    catch { throw integrity(); }
    if (!Number.isSafeInteger(object.sizeBytes) || object.sizeBytes < 1) throw integrity();
    if (object.contentType !== BOARD_ENCRYPTED_BLOB_CONTENT_TYPE) throw integrity();
    if (!input.key.endsWith(`/sha256/${object.cipherDigest}`)) throw integrity();
    return { cipherDigest: object.cipherDigest, sizeBytes: object.sizeBytes, contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE };
  }

  async listPurgeCandidates(input: Parameters<BoardBlobPurgeStore['listPurgeCandidates']>[0]): ReturnType<BoardBlobPurgeStore['listPurgeCandidates']> {
    if (!(input.createdBefore instanceof Date) || !Number.isFinite(input.createdBefore.getTime())
      || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000
      || input.cursor !== undefined && (input.cursor.length < 1 || input.cursor.length > 2_048 || /[\r\n\u0000]/.test(input.cursor))) {
      throw new BoardBlobError('INVALID_INPUT');
    }
    boardBlobKey({ tenantId: input.tenantId, boardId: input.boardId, kind: 'manifest', cipherDigest: '0'.repeat(64) });
    const keyPrefix = `${tenantStorageNamespace(input.tenantId)}/boards/${input.boardId}/`;
    await this.assertReady();
    let page: { objects: HostedBoardListedObject[]; nextCursor?: string };
    try { page = await this.client.list({ keyPrefix, limit: input.limit, ...(input.cursor ? { cursor: input.cursor } : {}) }); }
    catch { throw unavailable(); }
    if (page.nextCursor !== undefined && (page.nextCursor === input.cursor || page.nextCursor.length < 1
      || page.nextCursor.length > 2_048 || /[\r\n\u0000]/.test(page.nextCursor))) throw unavailable();
    const candidates = [];
    for (const listed of page.objects) {
      if (!listed.key.startsWith(keyPrefix)) throw unavailable();
      assertTenantBlobKey(input.tenantId, listed.key);
      if (!(listed.createdAt instanceof Date) || !Number.isFinite(listed.createdAt.getTime())
        || listed.createdAt.getTime() > input.createdBefore.getTime()) continue;
      let object: Omit<HostedBoardBlobObject, 'bytes'> | null;
      try { object = await this.client.head(listed.key); }
      catch { throw unavailable(); }
      if (!object) continue;
      if (object.cipherDigest === undefined || object.sizeBytes === undefined
        || object.contentType !== BOARD_ENCRYPTED_BLOB_CONTENT_TYPE || !(object.createdAt instanceof Date)
        || !Number.isFinite(object.createdAt.getTime()) || object.createdAt.getTime() > input.createdBefore.getTime()) throw integrity();
      try { assertSha256Digest(object.cipherDigest); }
      catch { throw integrity(); }
      if (!Number.isSafeInteger(object.sizeBytes) || object.sizeBytes < 1
        || !listed.key.endsWith(`/sha256/${object.cipherDigest}`)) throw integrity();
      candidates.push({ tenantId: input.tenantId, key: listed.key, cipherDigest: object.cipherDigest,
        sizeBytes: object.sizeBytes, contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, createdAt: object.createdAt });
    }
    return { candidates, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
  }

  async purgeCandidate(input: Parameters<BoardBlobPurgeStore['purgeCandidate']>[0]): ReturnType<BoardBlobPurgeStore['purgeCandidate']> {
    this.validateWriteDescriptor(input);
    if (!(input.createdAt instanceof Date) || !(input.createdBefore instanceof Date)
      || !Number.isFinite(input.createdAt.getTime()) || !Number.isFinite(input.createdBefore.getTime())) throw new BoardBlobError('INVALID_INPUT');
    await this.assertReady();
    let object: Omit<HostedBoardBlobObject, 'bytes'> | null;
    try { object = await this.client.head(input.key); }
    catch { throw unavailable(); }
    if (!object) return 'not-found';
    if (object.cipherDigest !== input.cipherDigest || object.sizeBytes !== input.sizeBytes
      || object.contentType !== input.contentType || !(object.createdAt instanceof Date)
      || object.createdAt.getTime() !== input.createdAt.getTime() || object.createdAt.getTime() > input.createdBefore.getTime()) return 'changed-or-too-new';
    if (!object.versionId) throw unavailable();
    try {
      const result = await this.client.deleteCurrent(input.key, object.versionId);
      const remaining = await this.client.head(input.key);
      if (remaining) return 'changed-or-too-new';
      return result === 'not-found' ? 'not-found' : 'deleted';
    } catch (error) {
      if (error instanceof BoardBlobError) throw error;
      throw unavailable();
    }
  }

  private async tryVerified(input: BoardBlobIdentity & BoardBlobDescriptor): Promise<boolean> {
    try {
      await this.getVerified({ ...input, expectedCipherDigest: input.cipherDigest, expectedSizeBytes: input.sizeBytes, expectedContentType: input.contentType });
      return true;
    } catch (error) {
      if (error instanceof BoardBlobError && (error.code === 'NOT_FOUND' || error.code === 'INTEGRITY_FAILED')) return false;
      throw error;
    }
  }

  private validateWrite(input: BoardBlobIdentity & BoardBlobDescriptor & { ciphertext: Uint8Array }): void {
    this.validateWriteDescriptor(input);
    if (!(input.ciphertext instanceof Uint8Array) || input.sizeBytes < 1 || !Number.isSafeInteger(input.sizeBytes)
      || input.ciphertext.byteLength !== input.sizeBytes || sha256(input.ciphertext) !== input.cipherDigest
      || !input.key.endsWith(`/sha256/${input.cipherDigest}`)) throw new BoardBlobError('INVALID_INPUT');
  }

  private validateWriteDescriptor(input: BoardBlobIdentity & BoardBlobDescriptor): void {
    assertTenantBlobKey(input.tenantId, input.key); assertSha256Digest(input.cipherDigest);
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.contentType !== BOARD_ENCRYPTED_BLOB_CONTENT_TYPE
      || !input.key.endsWith(`/sha256/${input.cipherDigest}`)) throw new BoardBlobError('INVALID_INPUT');
  }

  private validateRead(input: Parameters<BoardBlobStore['getVerified']>[0]): void {
    assertTenantBlobKey(input.tenantId, input.key); assertSha256Digest(input.expectedCipherDigest);
    if (!Number.isSafeInteger(input.expectedSizeBytes) || input.expectedSizeBytes < 1
      || input.expectedContentType !== BOARD_ENCRYPTED_BLOB_CONTENT_TYPE) throw new BoardBlobError('INVALID_INPUT');
  }
}

export class OssBoardBlobStore extends HostedBoardBlobStore {
  constructor(client: HostedBoardBlobClient, requirement: HostedBoardBlobPolicyRequirement) {
    if (client.provider !== 'aliyun-oss') throw new BoardBlobError('INVALID_INPUT', 'OSS Board adapter requires an OSS client');
    super(client, requirement);
  }
}

export class S3CompatibleBoardBlobStore extends HostedBoardBlobStore {
  constructor(client: HostedBoardBlobClient, requirement: HostedBoardBlobPolicyRequirement) {
    if (client.provider !== 's3-compatible') throw new BoardBlobError('INVALID_INPUT', 'S3 Board adapter requires an S3-compatible client');
    super(client, requirement);
  }
}
