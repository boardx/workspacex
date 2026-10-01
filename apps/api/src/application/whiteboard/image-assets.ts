import { createHash } from 'node:crypto';
import { WhiteboardAssetId, WhiteboardAssetMetadata, type WhiteboardImageMime } from '@repo/contracts/whiteboard-asset';
import type { z } from 'zod';
import type { Principal } from '../../domain/principal';
import type { WhiteboardRepository } from './ports';
import { ObjectExistsError, type ObjectStore } from '../artifact/ports';
import { DisabledBoardAssetDownloadGrantSigner, type BoardAssetDownloadGrantSigner } from './asset-download-grant';
export const WHITEBOARD_IMAGE_ASSETS = Symbol('WhiteboardImageAssets');
export class WhiteboardImageError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_IMAGE' | 'IMAGE_TOO_LARGE' | 'DEPENDENCY_UNAVAILABLE' | 'INTEGRITY_FAILED' | 'RATE_LIMITED') { super(code); }
}
export interface VerifiedBoardImage { bytes: Uint8Array; metadata: WhiteboardAssetMetadata; }
export interface BoardImageVerifier { verify(bytes: Uint8Array, declaredMime: z.infer<typeof WhiteboardImageMime>): Promise<VerifiedBoardImage>; }
export interface BoardImageAssetRecord { metadata: WhiteboardAssetMetadata; objectKey: string; }
export interface BoardImageAssetRepository {
  save(principal: Principal, boardId: string, record: BoardImageAssetRecord): Promise<void>;
  savePending(principal: Principal, boardId: string, record: BoardImageAssetRecord, importId: string): Promise<void>;
  get(principal: Principal, boardId: string, assetId: string): Promise<BoardImageAssetRecord | null>;
}
export interface PendingBoardImageAsset {
  metadata: WhiteboardAssetMetadata;
  ref: { objectKey: string; contentHash: string; byteSize: number };
}
export class WhiteboardImageAssets {
  constructor(private readonly boards: WhiteboardRepository, private readonly repository: BoardImageAssetRepository,
    private readonly objects: Pick<ObjectStore, 'putOnce' | 'get' | 'head'>, private readonly verifier: BoardImageVerifier,
    private readonly grants: BoardAssetDownloadGrantSigner = new DisabledBoardAssetDownloadGrantSigner(), private readonly now: () => Date = () => new Date()) {}
  private async access(p: Principal, boardId: string, write: boolean) {
    const board = await this.boards.get(p, boardId);
    if (!board) throw new WhiteboardImageError('NOT_FOUND');
    if (write && (!['owner','editor'].includes(board.role) || board.archived)) throw new WhiteboardImageError('FORBIDDEN');
  }
  private prefix(p: Principal, boardId: string) {
    return `whiteboards/tenants/${createHash('sha256').update(p.orgId).digest('hex').slice(0,32)}/boards/${boardId}/assets/`;
  }
  async inspect(p: Principal, boardId: string, bytes: Uint8Array, mime: Parameters<BoardImageVerifier['verify']>[1]) {
    await this.access(p, boardId, true);
    return (await this.verifier.verify(bytes, mime)).metadata;
  }
  async upload(p: Principal, boardId: string, bytes: Uint8Array, mime: z.infer<typeof WhiteboardImageMime>): Promise<WhiteboardAssetMetadata> {
    await this.access(p, boardId, true);
    const verified = await this.verifier.verify(bytes, mime), metadata = WhiteboardAssetMetadata.parse(verified.metadata);
    const objectKey = `${this.prefix(p, boardId)}${metadata.contentDigest.slice(7)}`;
    try { await this.objects.putOnce(objectKey, verified.bytes, metadata.mimeType); }
    catch (error) { if (!(error instanceof ObjectExistsError)) throw new WhiteboardImageError('DEPENDENCY_UNAVAILABLE'); }
    await this.verifiedBytes(p, boardId, { objectKey, metadata });
    await this.access(p, boardId, true);
    await this.repository.save(p, boardId, { objectKey, metadata });
    await this.access(p, boardId, true);
    return metadata;
  }
  async uploadPending(p: Principal, boardId: string, bytes: Uint8Array, mime: z.infer<typeof WhiteboardImageMime>, importId: string): Promise<PendingBoardImageAsset> {
    await this.access(p, boardId, true);
    const verified = await this.verifier.verify(bytes, mime), metadata = WhiteboardAssetMetadata.parse(verified.metadata);
    const objectKey = `${this.prefix(p, boardId)}${metadata.contentDigest.slice(7)}`;
    // Reserve before ObjectStore I/O. A crash or partial archive failure leaves
    // an expiring lease, never an active image without a canonical board object.
    await this.repository.savePending(p, boardId, { objectKey, metadata }, importId);
    try { await this.objects.putOnce(objectKey, verified.bytes, metadata.mimeType); }
    catch (error) { if (!(error instanceof ObjectExistsError)) throw new WhiteboardImageError('DEPENDENCY_UNAVAILABLE'); }
    await this.verifiedBytes(p, boardId, { objectKey, metadata });
    await this.access(p, boardId, true);
    return {
      metadata,
      ref: {
        objectKey,
        contentHash: metadata.contentDigest.slice(7),
        byteSize: metadata.byteSize,
      },
    };
  }
  private async verifiedBytes(p: Principal, boardId: string, record: BoardImageAssetRecord) {
    const expected = `${this.prefix(p, boardId)}${record.metadata.contentDigest.slice(7)}`;
    if (record.objectKey !== expected) throw new WhiteboardImageError('INTEGRITY_FAILED');
    let bytes: Uint8Array | null, head: { sizeBytes: number; mime: string } | null;
    try { [bytes, head] = await Promise.all([this.objects.get(record.objectKey), this.objects.head(record.objectKey)]); }
    catch { throw new WhiteboardImageError('DEPENDENCY_UNAVAILABLE'); }
    if (!bytes || !head || bytes.byteLength !== record.metadata.byteSize || head.sizeBytes !== bytes.byteLength || head.mime !== record.metadata.mimeType
      || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== record.metadata.contentDigest) throw new WhiteboardImageError('INTEGRITY_FAILED');
    return bytes;
  }
  async read(p: Principal, boardId: string, untrustedId: string) {
    const assetId = WhiteboardAssetId.parse(untrustedId);
    await this.access(p, boardId, false);
    const record = await this.repository.get(p, boardId, assetId);
    if (!record) throw new WhiteboardImageError('NOT_FOUND');
    const bytes = await this.verifiedBytes(p, boardId, record);
    // Membership may be revoked while ObjectStore I/O is pending. Every delivery
    // checks it again; cached possession of an asset ID is never an access grant.
    await this.access(p, boardId, false);
    return { metadata: record.metadata, bytes };
  }
  async issueDownloadGrant(p: Principal, boardId: string, untrustedId: string) {
    const assetId = WhiteboardAssetId.parse(untrustedId);
    // Read verifies current ACL and byte integrity before a usable token is minted.
    await this.read(p, boardId, assetId);
    try {
      const grant = this.grants.issue(p, boardId, assetId, this.now());
      return {
        downloadPath: `/whiteboards/${boardId}/assets/downloads/${grant.token}`,
        expiresAt: grant.expiresAt.toISOString(),
        oneTime: false as const,
      };
    } catch { throw new WhiteboardImageError('DEPENDENCY_UNAVAILABLE'); }
  }
  async readWithDownloadGrant(p: Principal, boardId: string, token: string) {
    const claim = this.grants.verify(p, boardId, token, this.now());
    if (!claim) throw new WhiteboardImageError('FORBIDDEN');
    // The signature is only a short-lived intent. Current Board ACL is still authoritative.
    return this.read(p, boardId, claim.assetId);
  }
}
