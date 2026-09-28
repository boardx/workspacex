import { ObjectExistsError, ObjectStoreUnavailableError, type ObjectStore } from '../../application/artifact/ports';
import type { OssObjectEncryptionMetadata, OssServerSideEncryption } from '../storage/oss-object-store';

export type WhiteboardObjectEncryptionPolicy =
  | { readonly backend: 'fs'; readonly mode: 'host-managed' }
  | { readonly backend: 'oss'; readonly encryption: OssServerSideEncryption };

interface OssEncryptionCapability {
  putOnceEncrypted(key: string, bytes: Uint8Array, mime: string, encryption: OssServerSideEncryption): Promise<void>;
  headEncryption(key: string): Promise<OssObjectEncryptionMetadata | null>;
}

const hasOssEncryption = (store: ObjectStore): store is ObjectStore & OssEncryptionCapability =>
  typeof (store as Partial<OssEncryptionCapability>).putOnceEncrypted === 'function'
  && typeof (store as Partial<OssEncryptionCapability>).headEncryption === 'function';

/** Configuration parser is intentionally strict and never interpolates a key id into errors. */
export function whiteboardObjectEncryptionPolicy(env: NodeJS.ProcessEnv = process.env): WhiteboardObjectEncryptionPolicy {
  const backend = env.WORKSPACEX_OBJECT_STORE ?? (env.WORKSPACEX_DEPLOY_PROFILE ? 'oss' : 'fs');
  if (backend === 'fs') {
    if (env.WORKSPACEX_DEPLOY_PROFILE) throw new Error('WHITEBOARD_ENCRYPTION_REQUIRED');
    if (env.WORKSPACEX_BOARD_OBJECT_SSE && env.WORKSPACEX_BOARD_OBJECT_SSE !== 'HOST_MANAGED') throw new Error('WHITEBOARD_ENCRYPTION_INVALID');
    return { backend: 'fs', mode: 'host-managed' };
  }
  if (backend !== 'oss') throw new Error('WHITEBOARD_ENCRYPTION_INVALID');
  const mode = env.WORKSPACEX_BOARD_OBJECT_SSE;
  if (mode === 'AES256') {
    if (env.WORKSPACEX_BOARD_OBJECT_KMS_KEY_ID) throw new Error('WHITEBOARD_ENCRYPTION_INVALID');
    return { backend: 'oss', encryption: { algorithm: 'AES256' } };
  }
  if (mode === 'KMS') {
    const keyId = env.WORKSPACEX_BOARD_OBJECT_KMS_KEY_ID;
    if (!keyId || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(keyId)) throw new Error('WHITEBOARD_ENCRYPTION_INVALID');
    return { backend: 'oss', encryption: { algorithm: 'KMS', keyId } };
  }
  throw new Error('WHITEBOARD_ENCRYPTION_REQUIRED');
}

/**
 * Whiteboard-only adapter. For hosted OSS, publication completes only after encryption
 * metadata is read back and matches the configured algorithm/key. Local FS remains an
 * explicit host-managed encryption boundary for self-hosted development.
 */
export class SecureWhiteboardObjectStore implements Pick<ObjectStore, 'putOnce' | 'get' | 'head'> {
  constructor(private readonly store: ObjectStore, private readonly policy: WhiteboardObjectEncryptionPolicy) {}
  async putOnce(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    if (this.policy.backend === 'fs') return this.store.putOnce(key, bytes, mime);
    if (!hasOssEncryption(this.store)) throw new ObjectStoreUnavailableError('whiteboard encrypted object store unavailable');
    let existed = false;
    try { await this.store.putOnceEncrypted(key, bytes, mime, this.policy.encryption); }
    catch (error) { if (error instanceof ObjectExistsError) existed = true; else throw error; }
    const metadata = await this.store.headEncryption(key);
    const expectedKey = this.policy.encryption.algorithm === 'KMS' ? this.policy.encryption.keyId : null;
    if (!metadata || metadata.algorithm !== this.policy.encryption.algorithm || metadata.keyId !== expectedKey) {
      throw new ObjectStoreUnavailableError('whiteboard object encryption verification failed');
    }
    if (existed) throw new ObjectExistsError(key);
  }
  get(key: string) { return this.store.get(key); }
  head(key: string) { return this.store.head(key); }
}

export const WHITEBOARD_SECURE_OBJECT_STORE = Symbol('WhiteboardSecureObjectStore');
