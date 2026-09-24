import { randomUUID } from 'node:crypto';
import { whiteboard as W, whiteboardTransfer as C } from '@repo/contracts';
import type { Principal } from '../../domain/principal';
import type { DatabasePort } from '../../application/ports/database.port';
import { WhiteboardCollaborationError, type WhiteboardCollaborationStore, type WhiteboardUpdateValidator } from '../../application/whiteboard/collaboration-ports';
import { WhiteboardTransferError as Fault, type WhiteboardTransferStore, type TransferErrorCode } from '../../application/whiteboard/transfer-ports';
import { batchRequestId, canonicalImportHash, importPreview, parsePortableImport, remapPortableObjects } from '../../application/whiteboard/portable-board';

type BoardRow = { id: string; name: string; owner_id: string; archived: boolean; created_at: Date; updated_at: Date };
function boardView(row: BoardRow): W.Board {
  return W.Board.parse({ id: row.id, name: row.name, ownerId: row.owner_id, role: 'owner', archived: row.archived,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() });
}
function mapCollaborationError(error: unknown): never {
  if (error instanceof WhiteboardCollaborationError) {
    if (['NOT_FOUND', 'FORBIDDEN', 'ARCHIVED', 'IDEMPOTENCY_CONFLICT'].includes(error.code)) throw new Fault(error.code as TransferErrorCode);
    throw new Fault('VALIDATION_FAILED');
  }
  throw error;
}

/** Import only creates a new board. The source board is never replaced or mutated. */
export class PgWhiteboardTransferStore implements WhiteboardTransferStore {
  constructor(private readonly db: DatabasePort, private readonly collaboration: WhiteboardCollaborationStore, private readonly validator: WhiteboardUpdateValidator) {}

  async exportBoard(p: Principal, boardId: string): Promise<C.PortableBoardPackage> {
    if (!W.BoardId.safeParse(boardId).success) throw new Fault('VALIDATION_FAILED');
    let state: Awaited<ReturnType<WhiteboardCollaborationStore['load']>>;
    try { state = await this.collaboration.load(p, boardId); } catch (error) { mapCollaborationError(error); }
    const objects = await this.validator.objects(state!.update);
    const board = await this.db.withTenant(p.orgId, async session => {
      const result = await session.query<{ name: string }>(`SELECT b.name FROM whiteboards b LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$3 WHERE b.org_id=$1 AND b.id=$2 AND (b.owner_id=$3 OR m.user_id IS NOT NULL)`, [p.orgId, boardId, p.userId]);
      if (!result.rows[0]) throw new Fault('NOT_FOUND');
      await session.query(`INSERT INTO whiteboard_transfer_audit(org_id,board_id,actor_id,action,object_count) VALUES($1,$2,$3,'export',$4)`, [p.orgId, boardId, p.userId, objects.length]);
      return result.rows[0];
    });
    return C.PortableBoardPackage.parse({ format: C.PORTABLE_BOARD.format, schemaVersion: C.PORTABLE_BOARD.schemaVersion,
      exportedAt: new Date().toISOString(), source: { application: 'WorkspaceX', boardId, name: board.name }, objects,
      provenance: { objectCount: objects.length, contentModel: 'whiteboard-object.v1' } });
  }

  async previewImport(_p: Principal, raw: C.ImportBoardInput): Promise<C.ImportBoardPreview> {
    return importPreview(parsePortableImport(raw));
  }

  async importBoard(p: Principal, raw: C.ImportBoardInput) {
    const input = parsePortableImport(raw), preview = importPreview(input), hash = canonicalImportHash(input);
    const objects = remapPortableObjects(input.package.objects);
    return this.db.withTenant(p.orgId, async session => {
      const replay = await session.query<{ request_hash: string; board_id: string; imported_objects: number }>(`SELECT request_hash,board_id,imported_objects FROM whiteboard_import_receipts WHERE org_id=$1 AND actor_id=$2 AND request_id=$3`, [p.orgId,p.userId,input.requestId]);
      if (replay.rows[0]) {
        if (replay.rows[0].request_hash !== hash) throw new Fault('IDEMPOTENCY_CONFLICT');
        const found = await session.query<BoardRow>(`SELECT id,name,owner_id,archived,created_at,updated_at FROM whiteboards WHERE org_id=$1 AND owner_id=$2 AND id=$3`, [p.orgId,p.userId,replay.rows[0].board_id]);
        if (!found.rows[0]) throw new Fault('NOT_FOUND');
        return { board: boardView(found.rows[0]), importedObjects: replay.rows[0].imported_objects, remappedObjects: replay.rows[0].imported_objects, replayed: true };
      }
      const id = randomUUID();
      const inserted = await session.query<BoardRow>(`INSERT INTO whiteboards(id,org_id,owner_id,request_id,name) VALUES($1,$2,$3,$4,$5) ON CONFLICT(org_id,owner_id,request_id) DO NOTHING RETURNING id,name,owner_id,archived,created_at,updated_at`, [id,p.orgId,p.userId,input.requestId,preview.destinationName]);
      if (!inserted.rows[0]) {
        const concurrent = await session.query<{ request_hash: string; board_id: string; imported_objects: number }>(`SELECT request_hash,board_id,imported_objects FROM whiteboard_import_receipts WHERE org_id=$1 AND actor_id=$2 AND request_id=$3`, [p.orgId,p.userId,input.requestId]);
        if (!concurrent.rows[0] || concurrent.rows[0].request_hash !== hash) throw new Fault('IDEMPOTENCY_CONFLICT');
        const found = await session.query<BoardRow>(`SELECT id,name,owner_id,archived,created_at,updated_at FROM whiteboards WHERE org_id=$1 AND owner_id=$2 AND id=$3`, [p.orgId,p.userId,concurrent.rows[0].board_id]);
        if (!found.rows[0]) throw new Fault('NOT_FOUND');
        return { board: boardView(found.rows[0]), importedObjects: concurrent.rows[0].imported_objects, remappedObjects: concurrent.rows[0].imported_objects, replayed: true };
      }
      await session.query(`INSERT INTO whiteboard_documents(org_id,board_id) VALUES($1,$2)`, [p.orgId,id]);
      try {
        for (let index = 0; index < objects.length; index += 200) {
          await this.collaboration.writeCommandsInTransaction(session, p, id, { epoch: 1, requestId: batchRequestId(input.requestId, index / 200), commands: objects.slice(index,index+200).map(object => ({ type: 'create' as const, object })) });
        }
      } catch (error) { mapCollaborationError(error); }
      await session.query(`INSERT INTO whiteboard_import_receipts(org_id,actor_id,request_id,request_hash,board_id,source_board_id,imported_objects) VALUES($1,$2,$3,$4,$5,$6,$7)`, [p.orgId,p.userId,input.requestId,hash,id,input.package.source.boardId,objects.length]);
      await session.query(`INSERT INTO whiteboard_transfer_audit(org_id,board_id,actor_id,action,object_count,source_board_id) VALUES($1,$2,$3,'import',$4,$5)`, [p.orgId,id,p.userId,objects.length,input.package.source.boardId]);
      return { board: boardView(inserted.rows[0]), importedObjects: objects.length, remappedObjects: objects.length, replayed: false };
    });
  }
}
