export const BOARD_BLOB_STORE = Symbol('BoardBlobStore');
export const BOARD_BLOB_CODEC = Symbol('BoardBlobCodec');
export { BoardBlobError, type BoardBlobErrorCode } from '../../domain/whiteboard/blob-errors';

export interface BoardBlobIdentity {
  tenantId: string;
  key: string;
}

export interface BoardBlobDescriptor {
  cipherDigest: string;
  sizeBytes: number;
}

export interface BoardBlobStore {
  putImmutable(input: BoardBlobIdentity & BoardBlobDescriptor & { ciphertext: Uint8Array }): Promise<'created' | 'already-present-same-content'>;
  getVerified(input: BoardBlobIdentity & { expectedCipherDigest: string; expectedSizeBytes: number }): Promise<Uint8Array>;
  head(input: BoardBlobIdentity): Promise<BoardBlobDescriptor | null>;
}

export interface EncodedBoardBlob extends BoardBlobDescriptor {
  ciphertext: Uint8Array;
  plainDigest: string;
  tenantKeyVersion: number;
}

export interface BoardBlobCodec {
  encrypt(input: { tenantId: string; tenantKeyVersion: number; plaintext: Uint8Array }): Promise<EncodedBoardBlob>;
  decrypt(input: EncodedBoardBlob & { tenantId: string; expectedPlainDigest: string }): Promise<Uint8Array>;
}
