import { WhiteboardFileMetadata } from '@repo/contracts/whiteboard-file';
import type { DatabasePort } from '../../application/ports/database.port';
import type { Principal } from '../../domain/principal';
import type { BoardFileRecord, BoardFileRepository } from '../../application/whiteboard/file-assets';
import { WhiteboardFileError } from '../../application/whiteboard/file-assets';
import type { WhiteboardRepository } from '../../application/whiteboard/ports';
import { discloseDecided, guard, isDisclosed } from '../../application/security/permission-filter';
import { decideWhiteboardAccess } from '../../domain/whiteboard/access-decision';

export class PgBoardFileAssets implements BoardFileRepository {
  constructor(private readonly db: DatabasePort, private readonly boards: WhiteboardRepository) {}
  async save(p: Principal, boardId: string, record: BoardFileRecord) {
    const board = await this.boards.get(p, boardId);
    if (!board) throw new WhiteboardFileError('NOT_FOUND');
    if (board.archived || !['owner', 'editor'].includes(board.role)) throw new WhiteboardFileError('FORBIDDEN');
    await this.db.withTenant(p.orgId, async session => {
      await session.query(`INSERT INTO whiteboard_asset_refs(org_id,board_id,object_key,content_hash,byte_size,state,activated_at)
        VALUES($1,$2,$3,$4,$5,'active',now()) ON CONFLICT(org_id,board_id,object_key) DO UPDATE SET state='active',activated_at=now(),released_at=NULL,lease_expires_at=NULL`,
      [p.orgId, boardId, record.objectKey, record.metadata.contentDigest.slice(7), record.metadata.byteSize]);
      await session.query(`INSERT INTO whiteboard_file_assets(org_id,board_id,asset_id,object_key,metadata)
        VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(org_id,board_id,asset_id) DO NOTHING`,
      [p.orgId, boardId, record.metadata.assetId, record.objectKey, JSON.stringify(record.metadata)]);
    });
  }
  async get(p: Principal, boardId: string, assetId: string): Promise<BoardFileRecord | null> {
    const board = await this.boards.get(p, boardId);
    if (!board) throw new WhiteboardFileError('NOT_FOUND');
    return this.db.withTenant(p.orgId, async session => {
      const result = await session.query<{ object_key: string; metadata: unknown }>(`SELECT a.object_key,a.metadata FROM whiteboard_file_assets a
        JOIN whiteboard_asset_refs r ON r.org_id=a.org_id AND r.board_id=a.board_id AND r.object_key=a.object_key
        WHERE a.org_id=$1 AND a.board_id=$2 AND a.asset_id=$3 AND r.state='active' AND r.released_at IS NULL`, [p.orgId, boardId, assetId]);
      const row = result.rows[0];
      const payload = row ? { objectKey: row.object_key, metadata: WhiteboardFileMetadata.parse(row.metadata) } : null;
      const disclosed = discloseDecided(guard({ kind: 'whiteboard', id: boardId }, payload), decideWhiteboardAccess({ decisionId: `whiteboard:${boardId}:read`, role: board.role, action: 'read' }));
      if (!isDisclosed(disclosed)) throw new WhiteboardFileError('FORBIDDEN');
      return disclosed.payload;
    });
  }
}
