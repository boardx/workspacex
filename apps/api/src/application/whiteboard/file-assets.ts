import { createHash } from 'node:crypto';
import { WhiteboardFileAssetId, WhiteboardFileMetadata, WHITEBOARD_FILE_LIMITS } from '@repo/contracts/whiteboard-file';
import type { Principal } from '../../domain/principal';
import type { WhiteboardRepository } from './ports';
import { ObjectExistsError, type ObjectStore } from '../artifact/ports';

export const WHITEBOARD_FILE_ASSETS = Symbol('WhiteboardFileAssets');
export class WhiteboardFileError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_FILE' | 'FILE_TOO_LARGE' | 'DEPENDENCY_UNAVAILABLE' | 'INTEGRITY_FAILED') { super(code); }
}
export interface BoardFileRecord { metadata: WhiteboardFileMetadata; objectKey: string }
export interface BoardFileRepository {
  save(p: Principal, boardId: string, record: BoardFileRecord): Promise<void>;
  get(p: Principal, boardId: string, assetId: string): Promise<BoardFileRecord | null>;
}
export class WhiteboardFileAssets {
  constructor(private readonly boards: WhiteboardRepository, private readonly repository: BoardFileRepository,
    private readonly objects: Pick<ObjectStore, 'putOnce' | 'get' | 'head'>) {}
  private async access(p: Principal, boardId: string, write: boolean) {
    const board = await this.boards.get(p, boardId);
    if (!board) throw new WhiteboardFileError('NOT_FOUND');
    if (write && (!['owner', 'editor'].includes(board.role) || board.archived)) throw new WhiteboardFileError('FORBIDDEN');
  }
  private key(p: Principal, boardId: string, digest: string) {
    return `whiteboards/tenants/${createHash('sha256').update(p.orgId).digest('hex').slice(0, 32)}/boards/${boardId}/files/${digest.slice(7)}`;
  }
  private async bytes(p: Principal, boardId: string, record: BoardFileRecord) {
    if (record.objectKey !== this.key(p, boardId, record.metadata.contentDigest)) throw new WhiteboardFileError('INTEGRITY_FAILED');
    let bytes: Uint8Array | null, head: { sizeBytes: number; mime: string } | null;
    try { [bytes, head] = await Promise.all([this.objects.get(record.objectKey), this.objects.head(record.objectKey)]); }
    catch { throw new WhiteboardFileError('DEPENDENCY_UNAVAILABLE'); }
    if (!bytes || !head || bytes.byteLength !== record.metadata.byteSize || head.sizeBytes !== bytes.byteLength || head.mime !== 'application/octet-stream'
      || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== record.metadata.contentDigest) throw new WhiteboardFileError('INTEGRITY_FAILED');
    return bytes;
  }
  async upload(p: Principal, boardId: string, bytes: Uint8Array, fileName: string, mimeType: string) {
    await this.access(p, boardId, true);
    if (bytes.byteLength > WHITEBOARD_FILE_LIMITS.bytes) throw new WhiteboardFileError('FILE_TOO_LARGE');
    const contentDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const parsed = WhiteboardFileMetadata.safeParse({ assetId: `board-file-${contentDigest.slice(7)}`, fileName, mimeType: mimeType || 'application/octet-stream', byteSize: bytes.byteLength, contentDigest, persistence: 'durable' });
    if (!parsed.success) throw new WhiteboardFileError('INVALID_FILE');
    const metadata = parsed.data, record = { metadata, objectKey: this.key(p, boardId, contentDigest) };
    // Arbitrary files always download as attachments; their declared MIME is display metadata only.
    try { await this.objects.putOnce(record.objectKey, bytes, 'application/octet-stream'); }
    catch (error) { if (!(error instanceof ObjectExistsError)) throw new WhiteboardFileError('DEPENDENCY_UNAVAILABLE'); }
    await this.bytes(p, boardId, record);
    await this.access(p, boardId, true);
    await this.repository.save(p, boardId, record);
    await this.access(p, boardId, true);
    const stored = await this.repository.get(p, boardId, metadata.assetId);
    if (!stored) throw new WhiteboardFileError('DEPENDENCY_UNAVAILABLE');
    await this.access(p, boardId, true);
    return stored.metadata;
  }
  async read(p: Principal, boardId: string, untrustedId: string) {
    const assetId = WhiteboardFileAssetId.parse(untrustedId);
    await this.access(p, boardId, false);
    const record = await this.repository.get(p, boardId, assetId);
    if (!record) throw new WhiteboardFileError('NOT_FOUND');
    const bytes = await this.bytes(p, boardId, record);
    await this.access(p, boardId, false);
    return { metadata: record.metadata, bytes };
  }
}
