import { createHash } from 'node:crypto';
import { BoardBlobError } from './blob-errors';

const DIGEST = /^[a-f0-9]{64}$/;
const KEY = /^[a-z0-9][a-z0-9/_-]{0,511}$/;
const BOARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type BoardBlobKind = 'checkpoint' | 'update' | 'manifest' | 'import' | 'export' | 'asset';

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function tenantStorageNamespace(tenantId: string): string {
  if (typeof tenantId !== 'string' || tenantId.length < 1 || tenantId.length > 256 || tenantId.trim() !== tenantId) {
    throw new BoardBlobError('INVALID_INPUT', 'invalid tenant id');
  }
  return `tenants/${sha256(`workspacex-board-tenant:v1:${tenantId}`).slice(0, 32)}`;
}

export function boardBlobKey(input: { tenantId: string; boardId: string; kind: BoardBlobKind; cipherDigest: string }): string {
  if (!BOARD_ID.test(input.boardId) || !DIGEST.test(input.cipherDigest)) throw new BoardBlobError('INVALID_INPUT');
  return `${tenantStorageNamespace(input.tenantId)}/boards/${input.boardId}/${input.kind}/sha256/${input.cipherDigest}`;
}

export function assertTenantBlobKey(tenantId: string, key: string): void {
  if (typeof key !== 'string' || !KEY.test(key) || key.includes('//') || key.split('/').some(part => part === '.' || part === '..')) {
    throw new BoardBlobError('INVALID_INPUT', 'invalid board blob key');
  }
  if (!key.startsWith(`${tenantStorageNamespace(tenantId)}/`)) throw new BoardBlobError('INVALID_INPUT', 'blob key is outside the tenant namespace');
}

export function assertSha256Digest(value: string): void {
  if (!DIGEST.test(value)) throw new BoardBlobError('INVALID_INPUT', 'invalid sha256 digest');
}
