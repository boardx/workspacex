import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, BoardBlobError, type BoardBlobCodec, type EncodedBoardBlob } from '../../application/whiteboard/blob-ports';
import { assertSha256Digest, sha256 } from '../../domain/whiteboard/blob-identity';

export interface BoardTenantKeyResolver { resolve(tenantId: string, version: number): Promise<Uint8Array>; }

export class EnvBoardTenantKeyResolver implements BoardTenantKeyResolver {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async resolve(tenantId: string, version: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(version) || version < 1 || !tenantId) throw new BoardBlobError('INVALID_INPUT');
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
    return new Uint8Array(hkdfSync('sha256', master, Buffer.from(tenantId), Buffer.from(`workspacex-board-content:v${version}`), 32));
  }
}

const FORMAT_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class AesGcmBoardBlobCodec implements BoardBlobCodec {
  constructor(private readonly keys: BoardTenantKeyResolver) {}

  async encrypt(input: { tenantId: string; tenantKeyVersion: number; plaintext: Uint8Array }): Promise<EncodedBoardBlob> {
    if (!(input.plaintext instanceof Uint8Array)) throw new BoardBlobError('INVALID_INPUT');
    const key = await this.keys.resolve(input.tenantId, input.tenantKeyVersion), nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(this.aad(input.tenantId, input.tenantKeyVersion));
    const body = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
    const ciphertext = Buffer.concat([Buffer.from([FORMAT_VERSION]), nonce, cipher.getAuthTag(), body]);
    return { ciphertext: new Uint8Array(ciphertext), plainDigest: sha256(input.plaintext), cipherDigest: sha256(ciphertext), sizeBytes: ciphertext.byteLength, contentType: BOARD_ENCRYPTED_BLOB_CONTENT_TYPE, tenantKeyVersion: input.tenantKeyVersion };
  }

  async decrypt(input: EncodedBoardBlob & { tenantId: string; expectedPlainDigest: string }): Promise<Uint8Array> {
    assertSha256Digest(input.expectedPlainDigest); assertSha256Digest(input.cipherDigest);
    if (input.contentType !== BOARD_ENCRYPTED_BLOB_CONTENT_TYPE) throw new BoardBlobError('INTEGRITY_FAILED', 'encrypted Board blob MIME mismatch');
    if (!(input.ciphertext instanceof Uint8Array) || input.ciphertext.byteLength !== input.sizeBytes || sha256(input.ciphertext) !== input.cipherDigest) {
      throw new BoardBlobError('INTEGRITY_FAILED', 'ciphertext descriptor mismatch');
    }
    if (input.ciphertext.byteLength < 1 + NONCE_BYTES + TAG_BYTES || input.ciphertext[0] !== FORMAT_VERSION) {
      throw new BoardBlobError('INTEGRITY_FAILED', 'unsupported ciphertext format');
    }
    try {
      const key = await this.keys.resolve(input.tenantId, input.tenantKeyVersion);
      const nonce = input.ciphertext.slice(1, 1 + NONCE_BYTES), tag = input.ciphertext.slice(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(this.aad(input.tenantId, input.tenantKeyVersion)); decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(input.ciphertext.slice(1 + NONCE_BYTES + TAG_BYTES)), decipher.final()]);
      if (sha256(plaintext) !== input.expectedPlainDigest || input.plainDigest !== input.expectedPlainDigest) throw new BoardBlobError('INTEGRITY_FAILED', 'plaintext digest mismatch');
      return new Uint8Array(plaintext);
    } catch (error) {
      if (error instanceof BoardBlobError) throw error;
      throw new BoardBlobError('INTEGRITY_FAILED', 'board blob decryption failed');
    }
  }

  private aad(tenantId: string, version: number): Buffer { return Buffer.from(`workspacex-board-content\0${tenantId}\0${version}`); }
}
