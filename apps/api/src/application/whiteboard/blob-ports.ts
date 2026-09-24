export const BOARD_BLOB_STORE = Symbol('BoardBlobStore');
export const BOARD_BLOB_PURGE_STORE = Symbol('BoardBlobPurgeStore');
export const BOARD_BLOB_CODEC = Symbol('BoardBlobCodec');
export { BoardBlobError, type BoardBlobErrorCode } from '../../domain/whiteboard/blob-errors';

/** Every Board object is opaque authenticated ciphertext. Adapters must persist this exact MIME. */
export const BOARD_ENCRYPTED_BLOB_CONTENT_TYPE = 'application/octet-stream' as const;
export type BoardEncryptedBlobContentType = typeof BOARD_ENCRYPTED_BLOB_CONTENT_TYPE;

export interface BoardBlobIdentity {
  tenantId: string;
  key: string;
}

export interface BoardBlobDescriptor {
  cipherDigest: string;
  sizeBytes: number;
  contentType: BoardEncryptedBlobContentType;
}

export interface BoardBlobStore {
  putImmutable(input: BoardBlobIdentity & BoardBlobDescriptor & { ciphertext: Uint8Array }): Promise<'created' | 'already-present-same-content'>;
  getVerified(input: BoardBlobIdentity & { expectedCipherDigest: string; expectedSizeBytes: number; expectedContentType: BoardEncryptedBlobContentType }): Promise<Uint8Array>;
  head(input: BoardBlobIdentity): Promise<BoardBlobDescriptor | null>;
}

export interface BoardBlobPurgeCandidate extends BoardBlobIdentity, BoardBlobDescriptor {
  createdAt: Date;
}

/**
 * Separate retention authority. Ordinary writers receive only BoardBlobStore and therefore
 * cannot delete. Candidate enumeration is bounded, tenant/board scoped and watermarked;
 * callers must still lock the Board and re-check every committed manifest root before purge.
 */
export interface BoardBlobPurgeStore {
  listPurgeCandidates(input: {
    tenantId: string;
    boardId: string;
    createdBefore: Date;
    limit: number;
    cursor?: string;
  }): Promise<{ candidates: BoardBlobPurgeCandidate[]; nextCursor?: string }>;
  purgeCandidate(input: BoardBlobPurgeCandidate & { createdBefore: Date }): Promise<'deleted' | 'not-found' | 'changed-or-too-new'>;
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
