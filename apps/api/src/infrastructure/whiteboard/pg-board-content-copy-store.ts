import { createHash, randomUUID } from 'node:crypto';
import { whiteboard as C } from '@repo/contracts';
import type { z } from 'zod';
import { WHITEBOARD_UPDATE_LIMITS } from '@repo/whiteboard-core';
import type { Principal } from '../../domain/principal';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import type { BoardContentCopyPort, CapturedBoardContent, PreparedBoardContent } from '../../application/whiteboard/board-content-copy-port';
import { WhiteboardResourceError, type DuplicateBoard } from '../../application/whiteboard/ports';

type SourceRow = { owner_id: string; role: string | null; epoch: number; seq: string; snapshot: Buffer };
type JobRow = {
  request_hash: string; source_board_id: string; target_board_id: string | null; source_epoch: number | null; source_seq: string | null;
  object_count: number | null; connector_count: number | null; asset_count: number | null; status: string;
};
type BoardRow = {
  id: string; name: string; owner_id: string; role: string; archived: boolean; lifecycle_revision: number; tags_revision: number; tag_ids: string[];
  created_at: Date; updated_at: Date;
};

const requestHash = (sourceBoardId: string, input: DuplicateBoard) => createHash('sha256')
  .update(JSON.stringify({ operation: 'duplicate-board', sourceBoardId, requestId: input.requestId, targetName: input.targetName, expectedSource: input.expectedSource ?? null }))
  .digest('hex');
const boardColumns = `b.id,b.name,b.owner_id,b.archived,b.lifecycle_revision,b.tags_revision,b.created_at,b.updated_at,
  COALESCE(ARRAY(SELECT bt.tag_id FROM whiteboard_tag_bindings bt JOIN whiteboard_tags t
    ON t.org_id=bt.org_id AND t.id=bt.tag_id AND t.deleted_at IS NULL
    WHERE bt.org_id=b.org_id AND bt.board_id=b.id ORDER BY bt.tag_id),ARRAY[]::uuid[]) AS tag_ids,
  CASE WHEN b.owner_id=$2 THEN 'owner' ELSE m.role END AS role`;

function board(row: BoardRow): C.Board {
  return C.Board.parse({
    id: row.id, name: row.name, ownerId: row.owner_id, role: row.role, archived: row.archived, lifecycleRevision: row.lifecycle_revision,
    tagIds: row.tag_ids, tagsRevision: row.tags_revision,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  });
}
function receipt(input: DuplicateBoard, sourceBoardId: string, job: Pick<JobRow, 'source_epoch'|'source_seq'|'object_count'|'connector_count'|'asset_count'>): z.infer<typeof C.DuplicateBoardReceipt> {
  if (job.source_epoch === null || job.source_seq === null || job.object_count === null || job.connector_count === null || job.asset_count === null) {
    throw new WhiteboardResourceError('COPY_INTEGRITY_FAILED');
  }
  return C.DuplicateBoardReceipt.parse({
    requestId: input.requestId, sourceBoardId, sourceEpoch: job.source_epoch, sourceSeq: Number(job.source_seq),
    objectCount: job.object_count, connectorCount: job.connector_count, assetCount: job.asset_count,
  });
}

/** Legacy adapter: canonical content is still held by whiteboard_documents. */
export class PgBoardContentCopyStore implements BoardContentCopyPort {
  constructor(private readonly db: DatabasePort) {}

  async duplicate(p: Principal, sourceBoardId: string, input: DuplicateBoard, prepare: (captured: CapturedBoardContent) => PreparedBoardContent): Promise<C.DuplicateBoardResult> {
    const hash = requestHash(sourceBoardId, input);
    return this.db.withTenant(p.orgId, async session => {
      // Claim before doing the expensive transform. A conflicting concurrent
      // request blocks on the unique key, then replays the committed receipt.
      const jobId = randomUUID();
      const claimed = await session.query<{job_id:string}>(`INSERT INTO whiteboard_duplicate_requests(job_id,org_id,actor_id,request_id,request_hash,source_board_id,status)
        VALUES($1,$2,$3,$4,$5,$6,'running') ON CONFLICT(org_id,actor_id,request_id) DO NOTHING RETURNING job_id`,
      [jobId,p.orgId,p.userId,input.requestId,hash,sourceBoardId]);
      if (!claimed.rows[0]) {
        const prior = await session.query<JobRow>(`SELECT request_hash,source_board_id,target_board_id,source_epoch,source_seq,object_count,connector_count,asset_count,status
          FROM whiteboard_duplicate_requests WHERE org_id=$1 AND actor_id=$2 AND request_id=$3 FOR UPDATE`, [p.orgId,p.userId,input.requestId]);
        if (!prior.rows[0]) throw new WhiteboardResourceError('COPY_INTEGRITY_FAILED');
        return this.replay(session,p,sourceBoardId,input,hash,prior.rows[0]);
      }

      await this.assertDuplicable(session,p,sourceBoardId);
      // Lock order is Tag -> Board, matching tag mutation. The unlocked actor
      // preflight above prevents an inaccessible board id from being used to
      // lock organization tag rows. capture() rechecks access under Board lock.
      const sourceTagIds = await this.lockSourceTags(session,p,sourceBoardId);
      const captured = await this.capture(session,p,sourceBoardId);
      await this.assertTagsUnchanged(session,p,sourceBoardId,sourceTagIds);
      if (input.expectedSource && (input.expectedSource.epoch !== captured.source.epoch || input.expectedSource.seq !== captured.source.seq)) {
        throw new WhiteboardResourceError('SOURCE_VERSION_CHANGED');
      }
      let prepared: PreparedBoardContent;
      try { prepared = prepare(captured); }
      catch (error) {
        if (error instanceof WhiteboardResourceError) throw error;
        throw new WhiteboardResourceError('COPY_INTEGRITY_FAILED');
      }
      this.assertPrepared(prepared);
      const targetBoardId = randomUUID();
      await session.query(`INSERT INTO whiteboards(id,org_id,owner_id,request_id,name,lifecycle_revision,tags_revision)
        VALUES($1,$2,$3,$1,$4,0,0)`, [targetBoardId,p.orgId,p.userId,input.targetName]);
      await session.query(`INSERT INTO whiteboard_tag_bindings(org_id,board_id,tag_id)
        SELECT $1,$2,tag_id FROM unnest($3::uuid[]) AS tag_id`, [p.orgId,targetBoardId,sourceTagIds]);
      // A duplicate snapshot is the target's immutable baseline, not a replayed
      // source update. It therefore starts at epoch 1 / seq 0; the first accepted
      // edit advances to seq 1 through the normal collaboration transaction.
      await session.query(`INSERT INTO whiteboard_documents(org_id,board_id,epoch,seq,snapshot) VALUES($1,$2,1,0,$3)`, [p.orgId,targetBoardId,Buffer.from(prepared.snapshot)]);
      await session.query(`UPDATE whiteboard_duplicate_requests SET target_board_id=$4,source_epoch=$5,source_seq=$6,object_count=$7,connector_count=$8,asset_count=$9,status='completed',updated_at=now()
        WHERE org_id=$1 AND actor_id=$2 AND request_id=$3`, [p.orgId,p.userId,input.requestId,targetBoardId,captured.source.epoch,captured.source.seq,
        prepared.objectCount,prepared.connectorCount,prepared.assetCount]);
      const target = await this.target(session,p,targetBoardId);
      if (!target) throw new WhiteboardResourceError('COPY_INTEGRITY_FAILED');
      return C.DuplicateBoardResult.parse({ board: board(target), receipt: {
        requestId: input.requestId, sourceBoardId, sourceEpoch: captured.source.epoch, sourceSeq: captured.source.seq,
        objectCount: prepared.objectCount, connectorCount: prepared.connectorCount, assetCount: prepared.assetCount,
      } });
    });
  }

  private async assertDuplicable(session: TenantSession, p: Principal, sourceBoardId: string): Promise<void> {
    const visible = await session.query<{owner_id:string;role:string|null}>(`SELECT b.owner_id,CASE WHEN b.owner_id=$2 THEN 'owner' ELSE m.role END AS role
      FROM whiteboards b LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$2
      WHERE b.org_id=$1 AND b.id=$3 AND (b.owner_id=$2 OR m.role='editor')`, [p.orgId,p.userId,sourceBoardId]);
    if (!['owner','editor'].includes(visible.rows[0]?.role ?? '')) throw new WhiteboardResourceError('NOT_FOUND');
  }

  private async lockSourceTags(session: TenantSession, p: Principal, sourceBoardId: string): Promise<string[]> {
    const result = await session.query<{id:string}>(`SELECT t.id FROM whiteboard_tag_bindings bt
      JOIN whiteboard_tags t ON t.org_id=bt.org_id AND t.id=bt.tag_id AND t.deleted_at IS NULL
      JOIN whiteboards b ON b.org_id=bt.org_id AND b.id=bt.board_id
      LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$2
      WHERE b.org_id=$1 AND b.id=$3 AND (b.owner_id=$2 OR m.role='editor')
      ORDER BY t.id FOR SHARE OF t`, [p.orgId,p.userId,sourceBoardId]);
    return result.rows.map(row => row.id);
  }

  private async capture(session: TenantSession, p: Principal, sourceBoardId: string): Promise<CapturedBoardContent> {
    const locked = await session.query<{owner_id:string;role:string|null}>(`SELECT b.owner_id,CASE WHEN b.owner_id=$2 THEN 'owner' ELSE m.role END AS role
      FROM whiteboards b LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$2
      WHERE b.org_id=$1 AND b.id=$3 AND (b.owner_id=$2 OR m.role='editor') FOR SHARE OF b`, [p.orgId,p.userId,sourceBoardId]);
    if (!['owner','editor'].includes(locked.rows[0]?.role ?? '')) throw new WhiteboardResourceError('NOT_FOUND');
    await session.query(`INSERT INTO whiteboard_documents(org_id,board_id) VALUES($1,$2) ON CONFLICT(org_id,board_id) DO NOTHING`, [p.orgId,sourceBoardId]);
    const content = await session.query<Pick<SourceRow,'epoch'|'seq'|'snapshot'>>(`SELECT epoch,seq,snapshot FROM whiteboard_documents
      WHERE org_id=$1 AND board_id=$2 FOR SHARE`, [p.orgId,sourceBoardId]);
    const row = content.rows[0];
    if (!row) throw new WhiteboardResourceError('COPY_INTEGRITY_FAILED');
    const seq = Number(row.seq);
    if (!Number.isSafeInteger(seq) || seq < 0) throw new WhiteboardResourceError('COPY_INTEGRITY_FAILED');
    return { source: { epoch: row.epoch, seq }, snapshot: new Uint8Array(row.snapshot) };
  }

  private async assertTagsUnchanged(session: TenantSession, p: Principal, sourceBoardId: string, lockedTagIds: string[]): Promise<void> {
    const current = await session.query<{tag_id:string}>(`SELECT bt.tag_id FROM whiteboard_tag_bindings bt JOIN whiteboard_tags t
      ON t.org_id=bt.org_id AND t.id=bt.tag_id AND t.deleted_at IS NULL
      WHERE bt.org_id=$1 AND bt.board_id=$2 ORDER BY bt.tag_id`, [p.orgId,sourceBoardId]);
    const currentTagIds = current.rows.map(row => row.tag_id);
    if (currentTagIds.length !== lockedTagIds.length || currentTagIds.some((id,index) => id !== lockedTagIds[index])) {
      throw new WhiteboardResourceError('SOURCE_VERSION_CHANGED');
    }
  }

  private assertPrepared(prepared: PreparedBoardContent): void {
    if (!(prepared.snapshot instanceof Uint8Array) || prepared.snapshot.byteLength > WHITEBOARD_UPDATE_LIMITS.documentBytes
      || ![prepared.objectCount,prepared.connectorCount,prepared.assetCount].every(value => Number.isSafeInteger(value) && value >= 0)
      || prepared.connectorCount > prepared.objectCount || prepared.assetCount > prepared.objectCount) {
      throw new WhiteboardResourceError('COPY_INTEGRITY_FAILED');
    }
  }

  private async replay(session: TenantSession, p: Principal, sourceBoardId: string, input: DuplicateBoard, hash: string, job: JobRow): Promise<C.DuplicateBoardResult> {
    if (job.request_hash !== hash || job.source_board_id !== sourceBoardId) throw new WhiteboardResourceError('IDEMPOTENCY_CONFLICT');
    if (job.status !== 'completed' || !job.target_board_id) throw new WhiteboardResourceError('COPY_INTEGRITY_FAILED');
    const target = await this.target(session,p,job.target_board_id);
    if (!target) throw new WhiteboardResourceError('COPY_INTEGRITY_FAILED');
    return C.DuplicateBoardResult.parse({ board: board(target), receipt: receipt(input,sourceBoardId,job) });
  }

  private async target(session: TenantSession, p: Principal, targetBoardId: string): Promise<BoardRow | null> {
    const result = await session.query<BoardRow>(`SELECT ${boardColumns} FROM whiteboards b
      LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$2
      WHERE b.org_id=$1 AND b.id=$3 AND b.owner_id=$2`, [p.orgId,p.userId,targetBoardId]);
    return result.rows[0] ?? null;
  }
}
