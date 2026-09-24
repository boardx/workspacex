import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { BoardBlobError, type BoardBlobCodec, type EncodedBoardBlob } from '../../application/whiteboard/blob-ports';
import { assertSha256Digest, sha256 } from '../../domain/whiteboard/blob-identity';

export interface BoardTenantKeyResolver {
  readonly currentKeyId: string;
  resolve(tenantId: string, keyId: string, version: number): Promise<Uint8Array>;
}

export interface VersionedBoardMasterKeySource {
  /** Resolves an exact immutable version. Implementations may refresh provider credentials per call. */
  readonly currentKeyId: string;
  resolveVersion(input: { tenantId: string; keyId: string; version: number }): Promise<{ keyId: string; version: number; keyMaterial: Uint8Array }>;
}

export const DEFAULT_BOARD_KEY_ID = 'workspacex-board-content';
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function assertKeyId(value: string): void {
  if (!KEY_ID.test(value) || value.includes('..')) throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'board key identity is invalid');
}

function deriveTenantKey(master: Uint8Array, tenantId: string, version: number): Uint8Array {
  if (master.byteLength !== 32) throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'board content key material is invalid');
  return new Uint8Array(hkdfSync('sha256', master, Buffer.from(tenantId), Buffer.from(`workspacex-board-content:v${version}`), 32));
}

/** Production boundary for versioned KMS / secret-manager values. No unversioned fallback exists. */
export class KmsBoardTenantKeyResolver implements BoardTenantKeyResolver {
  private readonly seenMaterial = new Map<string, string>();
  readonly currentKeyId: string;

  constructor(private readonly source: VersionedBoardMasterKeySource) {
    assertKeyId(source.currentKeyId);
    this.currentKeyId = source.currentKeyId;
  }

  async resolve(tenantId: string, keyId: string, version: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(version) || version < 1 || !tenantId) throw new BoardBlobError('INVALID_INPUT');
    assertKeyId(keyId);
    try {
      const resolved = await this.source.resolveVersion({ tenantId, keyId, version });
      if (resolved.keyId !== keyId || resolved.version !== version || !(resolved.keyMaterial instanceof Uint8Array)) {
        throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'requested board key version is unavailable');
      }
      const sourceMaterial = resolved.keyMaterial;
      const master = new Uint8Array(sourceMaterial);
      try {
        const identity = `${tenantId}\0${keyId}\0${version}`;
        const fingerprint = createHash('sha256').update(master).digest('hex');
        const previous = this.seenMaterial.get(identity);
        if (previous !== undefined && previous !== fingerprint) {
          throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'board key material changed for an existing version');
        }
        this.seenMaterial.set(identity, fingerprint);
        return deriveTenantKey(master, tenantId, version);
      }
      finally { master.fill(0); sourceMaterial.fill(0); }
    } catch (error) {
      if (error instanceof BoardBlobError) throw error;
      throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'versioned board key service is unavailable');
    }
  }
}

export class EnvBoardTenantKeyResolver implements BoardTenantKeyResolver {
  readonly currentKeyId = 'development-env-board-content';
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async resolve(tenantId: string, keyId: string, version: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(version) || version < 1 || !tenantId) throw new BoardBlobError('INVALID_INPUT');
    if (keyId !== this.currentKeyId) throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'board key identity is unavailable');
    if (this.env.NODE_ENV === 'production') {
      throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'environment board keys are development-only');
    }
    let values: unknown;
    try { values = JSON.parse(this.env.WORKSPACEX_BOARD_CONTENT_KEYS ?? ''); }
    catch { throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'WORKSPACEX_BOARD_CONTENT_KEYS is missing or invalid'); }
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new BoardBlobError('ENCRYPTION_UNAVAILABLE');
    const encoded = (values as Record<string, unknown>)[String(version)];
    if (typeof encoded !== 'string') throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', `board content key version ${version} is unavailable`);
    const master = Buffer.from(encoded, 'base64');
    if (master.byteLength !== 32 || master.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
      throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'board content key must be 32 bytes of base64');
    }
    try { return deriveTenantKey(master, tenantId, version); }
    finally { master.fill(0); }
  }
}

const LEGACY_FORMAT_VERSION = 1;
const ENVELOPE_FORMAT_VERSION = 2;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DATA_KEY_BYTES = 32;
const VERSION_BYTES = 4;
const KEY_ID_LENGTH_BYTES = 2;

export class AesGcmBoardBlobCodec implements BoardBlobCodec {
  constructor(private readonly keys: BoardTenantKeyResolver) {}

  async encrypt(input: { tenantId: string; tenantKeyVersion: number; plaintext: Uint8Array }): Promise<EncodedBoardBlob> {
    if (!(input.plaintext instanceof Uint8Array)) throw new BoardBlobError('INVALID_INPUT');
    if (!Number.isSafeInteger(input.tenantKeyVersion) || input.tenantKeyVersion < 1 || input.tenantKeyVersion > 0xffff_ffff) throw new BoardBlobError('INVALID_INPUT');
    const keyId = this.keys.currentKeyId;
    assertKeyId(keyId);
    const keyIdBytes = Buffer.from(keyId, 'utf8');
    if (keyIdBytes.byteLength > 0xffff) throw new BoardBlobError('ENCRYPTION_UNAVAILABLE', 'board key identity is invalid');
    const wrappingKey = await this.keys.resolve(input.tenantId, keyId, input.tenantKeyVersion);
    const dataKey = randomBytes(DATA_KEY_BYTES);
    try {
      const wrapNonce = randomBytes(NONCE_BYTES);
      const wrapper = createCipheriv('aes-256-gcm', wrappingKey, wrapNonce);
      wrapper.setAAD(this.wrapAad(input.tenantId, keyId, input.tenantKeyVersion));
      const wrappedKey = Buffer.concat([wrapper.update(dataKey), wrapper.final()]);
      const contentNonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', dataKey, contentNonce);
      cipher.setAAD(this.contentAad(input.tenantId, keyId, input.tenantKeyVersion));
      const body = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
      const header = Buffer.alloc(KEY_ID_LENGTH_BYTES + VERSION_BYTES);
      header.writeUInt16BE(keyIdBytes.byteLength, 0);
      header.writeUInt32BE(input.tenantKeyVersion, KEY_ID_LENGTH_BYTES);
      const ciphertext = Buffer.concat([
        Buffer.from([ENVELOPE_FORMAT_VERSION]), header, keyIdBytes,
        wrapNonce, wrappedKey, wrapper.getAuthTag(), contentNonce, cipher.getAuthTag(), body,
      ]);
      return { ciphertext: new Uint8Array(ciphertext), plainDigest: sha256(input.plaintext), cipherDigest: sha256(ciphertext), sizeBytes: ciphertext.byteLength, tenantKeyVersion: input.tenantKeyVersion };
    } finally {
      wrappingKey.fill(0);
      dataKey.fill(0);
    }
  }

  async decrypt(input: EncodedBoardBlob & { tenantId: string; expectedPlainDigest: string }): Promise<Uint8Array> {
    assertSha256Digest(input.expectedPlainDigest); assertSha256Digest(input.cipherDigest);
    if (!(input.ciphertext instanceof Uint8Array) || input.ciphertext.byteLength !== input.sizeBytes || sha256(input.ciphertext) !== input.cipherDigest) {
      throw new BoardBlobError('INTEGRITY_FAILED', 'ciphertext descriptor mismatch');
    }
    if (input.ciphertext.byteLength < 1 + NONCE_BYTES + TAG_BYTES) {
      throw new BoardBlobError('INTEGRITY_FAILED', 'unsupported ciphertext format');
    }
    if (input.ciphertext[0] === LEGACY_FORMAT_VERSION) return this.decryptLegacy(input);
    if (input.ciphertext[0] !== ENVELOPE_FORMAT_VERSION) throw new BoardBlobError('INTEGRITY_FAILED', 'unsupported ciphertext format');
    try {
      const bytes = Buffer.from(input.ciphertext.buffer, input.ciphertext.byteOffset, input.ciphertext.byteLength);
      const keyIdLength = bytes.readUInt16BE(1);
      const version = bytes.readUInt32BE(1 + KEY_ID_LENGTH_BYTES);
      const fixed = 1 + KEY_ID_LENGTH_BYTES + VERSION_BYTES + keyIdLength + NONCE_BYTES + DATA_KEY_BYTES + TAG_BYTES + NONCE_BYTES + TAG_BYTES;
      if (keyIdLength < 1 || fixed > bytes.byteLength || version !== input.tenantKeyVersion) throw new BoardBlobError('INTEGRITY_FAILED', 'ciphertext key descriptor mismatch');
      const keyIdStart = 1 + KEY_ID_LENGTH_BYTES + VERSION_BYTES;
      const keyId = bytes.subarray(keyIdStart, keyIdStart + keyIdLength).toString('utf8');
      assertKeyId(keyId);
      let offset = keyIdStart + keyIdLength;
      const wrapNonce = bytes.subarray(offset, offset += NONCE_BYTES);
      const wrappedKey = bytes.subarray(offset, offset += DATA_KEY_BYTES);
      const wrapTag = bytes.subarray(offset, offset += TAG_BYTES);
      const contentNonce = bytes.subarray(offset, offset += NONCE_BYTES);
      const contentTag = bytes.subarray(offset, offset += TAG_BYTES);
      const wrappingKey = await this.keys.resolve(input.tenantId, keyId, version);
      let dataKey: Buffer | undefined;
      try {
        const unwrapper = createDecipheriv('aes-256-gcm', wrappingKey, wrapNonce);
        unwrapper.setAAD(this.wrapAad(input.tenantId, keyId, version)); unwrapper.setAuthTag(wrapTag);
        dataKey = Buffer.concat([unwrapper.update(wrappedKey), unwrapper.final()]);
        if (dataKey.byteLength !== DATA_KEY_BYTES) throw new BoardBlobError('INTEGRITY_FAILED', 'wrapped board data key is invalid');
        const decipher = createDecipheriv('aes-256-gcm', dataKey, contentNonce);
        decipher.setAAD(this.contentAad(input.tenantId, keyId, version)); decipher.setAuthTag(contentTag);
        const plaintext = Buffer.concat([decipher.update(bytes.subarray(offset)), decipher.final()]);
        if (sha256(plaintext) !== input.expectedPlainDigest || input.plainDigest !== input.expectedPlainDigest) throw new BoardBlobError('INTEGRITY_FAILED', 'plaintext digest mismatch');
        return new Uint8Array(plaintext);
      } finally {
        wrappingKey.fill(0);
        dataKey?.fill(0);
      }
    } catch (error) {
      if (error instanceof BoardBlobError) throw error;
      throw new BoardBlobError('INTEGRITY_FAILED', 'board blob decryption failed');
    }
  }

  private async decryptLegacy(input: EncodedBoardBlob & { tenantId: string; expectedPlainDigest: string }): Promise<Uint8Array> {
    const keyId = this.keys.currentKeyId;
    const key = await this.keys.resolve(input.tenantId, keyId, input.tenantKeyVersion);
    try {
      const nonce = input.ciphertext.slice(1, 1 + NONCE_BYTES), tag = input.ciphertext.slice(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(Buffer.from(`workspacex-board-content\0${input.tenantId}\0${input.tenantKeyVersion}`)); decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(input.ciphertext.slice(1 + NONCE_BYTES + TAG_BYTES)), decipher.final()]);
      if (sha256(plaintext) !== input.expectedPlainDigest || input.plainDigest !== input.expectedPlainDigest) throw new BoardBlobError('INTEGRITY_FAILED', 'plaintext digest mismatch');
      return new Uint8Array(plaintext);
    } catch (error) {
      if (error instanceof BoardBlobError) throw error;
      throw new BoardBlobError('INTEGRITY_FAILED', 'board blob decryption failed');
    } finally { key.fill(0); }
  }

  private wrapAad(tenantId: string, keyId: string, version: number): Buffer { return Buffer.from(`workspacex-board-key-wrap:v2\0${tenantId}\0${keyId}\0${version}`); }
  private contentAad(tenantId: string, keyId: string, version: number): Buffer { return Buffer.from(`workspacex-board-content:v2\0${tenantId}\0${keyId}\0${version}`); }
}
