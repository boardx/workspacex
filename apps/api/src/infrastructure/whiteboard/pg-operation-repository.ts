import { chatArtifactAccess } from './chat-artifact-access';
import { WhiteboardOperationEvent, WhiteboardOperationReceipt } from '@repo/contracts/whiteboard-operation';
import type { WhiteboardOperationAuditRepository } from '../../application/whiteboard/operation-ports';
import type { Principal } from '../../domain/principal';
import type { TenantSession } from '../../application/ports/database.port';

type Stored={request_hash:string;receipt:unknown};type Head={epoch:number;seq:string;actor_role:'owner'|'editor'|'viewer'|'commenter'};type EventRow={payload:unknown};
export class PgWhiteboardOperationRepository implements WhiteboardOperationAuditRepository{
  async replay(session:TenantSession,principal:Principal,boardId:string,requestId:string){const row=await session.query<Stored>('SELECT request_hash,receipt FROM whiteboard_operations WHERE org_id=$1 AND board_id=$2 AND request_id=$3',[principal.orgId,boardId,requestId]);const found=row.rows[0];return found?{requestHash:found.request_hash,receipt:WhiteboardOperationReceipt.parse(found.receipt)}:null;}
  async lockHead(session:TenantSession,principal:Principal,boardId:string){
    // Match the collaboration store's board -> document lock order. This both
    // serializes writers without a deadlock and initializes a new board's lazy
    // document before reading its revision.
    const access=await session.query<{owner_id:string;archived:boolean}>(
      'SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE',
      [principal.orgId,boardId],
    );
    const board=access.rows[0];
    if(!board)return null;
    let actorRole:Head['actor_role']='owner';
    if(board.owner_id!==principal.userId){
      const member=await session.query<{role:'editor'|'viewer'|'commenter'}>(
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
    return found?{epoch:found.epoch,seq:Number(found.seq),actorRole,archived:board.archived}:null;
  }
  async append(session:TenantSession,principal:Principal,input:Parameters<WhiteboardOperationAuditRepository['append']>[2]){const{receipt,event}=input;await session.query('INSERT INTO whiteboard_operations(org_id,board_id,request_id,request_hash,operation_id,actor_id,actor_kind,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[principal.orgId,receipt.boardId,receipt.requestId,input.requestHash,receipt.operationId,event.actor.actorId,event.actor.kind,JSON.stringify(receipt)]);await session.query('INSERT INTO whiteboard_operation_events(org_id,board_id,event_id,operation_id,revision_epoch,revision_seq,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[principal.orgId,receipt.boardId,event.eventId,receipt.operationId,event.revision.epoch,event.revision.seq,JSON.stringify(event)]);}
  async canRead(session:TenantSession,principal:Principal,boardId:string){const row=await session.query('SELECT 1 FROM whiteboards WHERE org_id=$1 AND id=$2 AND (owner_id=$3 OR EXISTS(SELECT 1 FROM whiteboard_members m WHERE m.org_id=$1 AND m.board_id=$2 AND m.user_id=$3))',[principal.orgId,boardId,principal.userId]);return Boolean(row.rows[0]);}
  async events(session:TenantSession,principal:Principal,boardId:string,afterSeq:number,limit:number,afterEpoch=1){const rows=await session.query<EventRow>('SELECT payload FROM whiteboard_operation_events WHERE org_id=$1 AND board_id=$2 AND (revision_epoch>$5 OR (revision_epoch=$5 AND revision_seq>$3)) ORDER BY revision_epoch,revision_seq,event_id LIMIT $4',[principal.orgId,boardId,afterSeq,limit,afterEpoch]);return rows.rows.map(row=>WhiteboardOperationEvent.parse(row.payload));}
  async lockRuntimeActor(session:TenantSession,principal:Principal,actorId:string){
    // Narrow SECURITY DEFINER locks the published pointer and enabled registry
    // until this transaction commits. app_rw never receives registry UPDATE.
    const result=await session.query<{binding:{actor:import('../../application/whiteboard/operation-ports').RegisteredBoardActor;agentVersionId:string;model:string;skillVersionIds:string[]}|null}>(
      'SELECT public.whiteboard_lock_ai_runtime($1,$2,$3) AS binding',[principal.orgId,actorId,principal.userId]);
    return result.rows[0]?.binding??null;
  }
  async resolveActor(session:TenantSession,principal:Principal,actorId:string){const row=await session.query<{actor_id:string;kind:'service'|'ai';delegated_by:string;scopes:string[];model_snapshot:string|null;skill_snapshot:string|null}>(`SELECT actor_id,kind,delegated_by,scopes,model_snapshot,skill_snapshot FROM whiteboard_actor_identities WHERE org_id=$1 AND actor_id=$2 AND delegated_by=$3 AND enabled=true`,[principal.orgId,actorId,principal.userId]);const value=row.rows[0];if(!value)return null;return{actorId:value.actor_id,kind:value.kind,delegatedBy:value.delegated_by,scopes:value.scopes.filter((scope):scope is 'board:read'|'board:write'|'board:present'|'artifact:read'=>['board:read','board:write','board:present','artifact:read'].includes(scope)),model:value.model_snapshot,skill:value.skill_snapshot};}
  async canReadArtifact(session:TenantSession,principal:Principal,artifactId:string,revision:string,layoutHash:string){const chatAccess=await chatArtifactAccess(session,principal,artifactId);if(chatAccess===false)return false;const row=await session.query(`SELECT 1 FROM artifacts a JOIN artifact_versions v ON v.org_id=a.org_id AND v.artifact_id=a.id JOIN whiteboard_artifact_layout_bindings l ON l.org_id=v.org_id AND l.artifact_id=v.artifact_id AND l.artifact_version_id=v.id WHERE a.org_id=$1 AND a.id=$2 AND ('artifact-v1:'||v.version_number::text)=$3 AND l.layout_digest=$5 AND ($6::boolean OR a.created_by=$4 OR EXISTS(SELECT 1 FROM acl_bindings b WHERE b.org_id=$1 AND b.object_kind='artifact' AND b.object_id=a.id AND (b.scope='org-wide' OR b.subject_id=$4)))`,[principal.orgId,artifactId,revision,principal.userId,layoutHash,chatAccess===true]);return Boolean(row.rows[0]);}
  async readArtifactSource(session:TenantSession,principal:Principal,artifactId:string,revision:string){const chatAccess=await chatArtifactAccess(session,principal,artifactId);if(chatAccess===false)return null;const row=await session.query<{version_id:string;object_key:string;content_hash:string;version_number:number}>(`SELECT v.id AS version_id,v.object_storage_key AS object_key,v.content_hash,v.version_number FROM artifacts a JOIN artifact_versions v ON v.org_id=a.org_id AND v.artifact_id=a.id WHERE a.org_id=$1 AND a.id=$2 AND ('artifact-v1:'||v.version_number::text)=$3 AND ($5::boolean OR a.created_by=$4 OR EXISTS(SELECT 1 FROM acl_bindings b WHERE b.org_id=$1 AND b.object_kind='artifact' AND b.object_id=a.id AND (b.scope='org-wide' OR b.subject_id=$4)))`,[principal.orgId,artifactId,revision,principal.userId,chatAccess===true]);const value=row.rows[0];return value?{versionId:value.version_id,objectKey:value.object_key,contentHash:value.content_hash,...(chatAccess===true?{chatMaterialization:{orgId:principal.orgId,artifactId,versionNumber:value.version_number}}:{})}:null;}
  async issueArtifactLayoutBinding(session:TenantSession,principal:Principal,artifactId:string,versionId:string,layoutHash:string){await session.query(`INSERT INTO whiteboard_artifact_layout_bindings(org_id,artifact_id,artifact_version_id,layout_digest) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,artifact_id,artifact_version_id,layout_digest) DO NOTHING`,[principal.orgId,artifactId,versionId,layoutHash]);const bound=await session.query(`SELECT 1 FROM whiteboard_artifact_layout_bindings WHERE org_id=$1 AND artifact_id=$2 AND artifact_version_id=$3 AND layout_digest=$4`,[principal.orgId,artifactId,versionId,layoutHash]);if(!bound.rows[0])throw new Error('BOARD_ARTIFACT_BINDING_CONFLICT');}
}
