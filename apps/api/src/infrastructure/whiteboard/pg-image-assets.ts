import type { Principal } from '../../domain/principal';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import type { BoardImageAssetRecord, BoardImageAssetRepository } from '../../application/whiteboard/image-assets';
import { WhiteboardAssetMetadata } from '@repo/contracts/whiteboard-asset';
export class PgBoardImageAssets implements BoardImageAssetRepository {
  constructor(private readonly db: DatabasePort) {}
  async save(p: Principal, boardId: string, record: BoardImageAssetRecord) {
    await this.db.withTenant(p.orgId,session=>this.saveInTransaction(session,p,boardId,record));
  }
  async saveInTransaction(session:TenantSession,p:Principal,boardId:string,record:BoardImageAssetRecord){

      await session.query(`INSERT INTO whiteboard_asset_refs(org_id,board_id,object_key,content_hash,byte_size,state,activated_at)
        VALUES($1,$2,$3,$4,$5,'active',now()) ON CONFLICT(org_id,board_id,object_key) DO UPDATE SET state='active',activated_at=now(),released_at=NULL,lease_expires_at=NULL`,
      [p.orgId, boardId, record.objectKey, record.metadata.contentDigest.slice(7), record.metadata.byteSize]);
      await session.query(`INSERT INTO whiteboard_image_assets(org_id,board_id,asset_id,object_key,metadata)
        VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(org_id,board_id,asset_id) DO NOTHING`,
      [p.orgId, boardId, record.metadata.assetId, record.objectKey, JSON.stringify(record.metadata)]);

  }
  async get(p: Principal, boardId: string, assetId: string): Promise<BoardImageAssetRecord | null> {
    return this.db.withTenant(p.orgId, async session => {
      const result = await session.query<{ object_key: string; metadata: unknown }>(`SELECT a.object_key,a.metadata FROM whiteboard_image_assets a
        JOIN whiteboard_asset_refs r ON r.org_id=a.org_id AND r.board_id=a.board_id AND r.object_key=a.object_key
        WHERE a.org_id=$1 AND a.board_id=$2 AND a.asset_id=$3 AND r.state='active' AND r.released_at IS NULL`, [p.orgId, boardId, assetId]);
      const row = result.rows[0];
      return row ? { objectKey:row.object_key, metadata:WhiteboardAssetMetadata.parse(row.metadata) } : null;
    });
  }
}
