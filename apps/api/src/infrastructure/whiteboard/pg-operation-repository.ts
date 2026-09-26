import { WhiteboardOperationEvent, WhiteboardOperationReceipt } from '@repo/contracts/whiteboard-operation';
import type { WhiteboardOperationAuditRepository } from '../../application/whiteboard/operation-ports';
import type { Principal } from '../../domain/principal';
import type { TenantSession } from '../../application/ports/database.port';

type Stored={request_hash:string;receipt:unknown};type Head={epoch:number;seq:string;actor_role:'owner'|'editor'|'viewer'};type EventRow={payload:unknown};
export class PgWhiteboardOperationRepository implements WhiteboardOperationAuditRepository{
  async replay(session:TenantSession,principal:Principal,boardId:string,requestId:string){const row=await session.query<Stored>('SELECT request_hash,receipt FROM whiteboard_operations WHERE org_id=$1 AND board_id=$2 AND request_id=$3',[principal.orgId,boardId,requestId]);const found=row.rows[0];return found?{requestHash:found.request_hash,receipt:WhiteboardOperationReceipt.parse(found.receipt)}:null;}
  async lockHead(session:TenantSession,principal:Principal,boardId:string){
    // Match the collaboration store's board -> document lock order. This both
    // serializes writers without a deadlock and initializes a new board's lazy
    // document before reading its revision.
    const access=await session.query<{owner_id:string}>(
      'SELECT owner_id FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE',
      [principal.orgId,boardId],
    );
    const board=access.rows[0];
    if(!board)return null;
    let actorRole:Head['actor_role']='owner';
    if(board.owner_id!==principal.userId){
      const member=await session.query<{role:'editor'|'viewer'}>(
        'SELECT role FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 AND user_id=$3',
        [principal.orgId,boardId,principal.userId],
      );
      const role=member.rows[0]?.role;
      if(!role)return null;
      actorRole=role;
    }
    await session.query(
      'INSERT INTO whiteboard_documents(org_id,board_id) VALUES($1,$2) ON CONFLICT(org_id,board_id) DO NOTHING',
      [principal.orgId,boardId],
    );
    const row=await session.query<{epoch:number;seq:string}>(
      'SELECT epoch,seq::text FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2',
      [principal.orgId,boardId],
    );
    const found=row.rows[0];
    return found?{epoch:found.epoch,seq:Number(found.seq),actorRole}:null;
  }
  async append(session:TenantSession,principal:Principal,input:Parameters<WhiteboardOperationAuditRepository['append']>[2]){const{receipt,event}=input;await session.query('INSERT INTO whiteboard_operations(org_id,board_id,request_id,request_hash,operation_id,actor_id,actor_kind,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[principal.orgId,receipt.boardId,receipt.requestId,input.requestHash,receipt.operationId,event.actor.actorId,event.actor.kind,JSON.stringify(receipt)]);await session.query('INSERT INTO whiteboard_operation_events(org_id,board_id,event_id,operation_id,revision_epoch,revision_seq,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[principal.orgId,receipt.boardId,event.eventId,receipt.operationId,event.revision.epoch,event.revision.seq,JSON.stringify(event)]);}
  async canRead(session:TenantSession,principal:Principal,boardId:string){const row=await session.query('SELECT 1 FROM whiteboards WHERE org_id=$1 AND id=$2 AND (owner_id=$3 OR EXISTS(SELECT 1 FROM whiteboard_members m WHERE m.org_id=$1 AND m.board_id=$2 AND m.user_id=$3))',[principal.orgId,boardId,principal.userId]);return Boolean(row.rows[0]);}
  async events(session:TenantSession,principal:Principal,boardId:string,afterSeq:number,limit:number){const rows=await session.query<EventRow>('SELECT payload FROM whiteboard_operation_events WHERE org_id=$1 AND board_id=$2 AND revision_seq>$3 ORDER BY revision_seq,event_id LIMIT $4',[principal.orgId,boardId,afterSeq,limit]);return rows.rows.map(row=>WhiteboardOperationEvent.parse(row.payload));}
}
