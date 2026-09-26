import { createHash, randomUUID } from "node:crypto";
import { whiteboard as C } from "@repo/contracts";
import { WhiteboardCommentCommand, WhiteboardCommentThread, type WhiteboardCollaborationEvent, type WhiteboardCommentCommand as CommentCommand } from "@repo/contracts/whiteboard-collaboration";
import { WhiteboardCommentService } from "@repo/whiteboard-core";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { WhiteboardCommentStore, WhiteboardUpdateValidator } from "../../application/whiteboard/collaboration-ports";
import { WhiteboardCollaborationError } from "../../application/whiteboard/collaboration-ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { discloseDecided,guard,isDisclosed } from "../../application/security/permission-filter";
import { decideWhiteboardAccess } from "../../domain/whiteboard/access-decision";

const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function disclose<T>(boardId:string,role:C.Board['role'],action:"read"|"comment",payload:T):T {const result=discloseDecided(guard({kind:"whiteboard",id:boardId},payload),decideWhiteboardAccess({decisionId:`whiteboard:${boardId}:${action}`,role,action}));if(!isDisclosed(result))throw new WhiteboardCollaborationError("FORBIDDEN");return result.payload;}

export class PgWhiteboardCommentStore implements WhiteboardCommentStore {
  constructor(private readonly db:DatabasePort,private readonly validator:WhiteboardUpdateValidator,private readonly now:()=>Date=()=>new Date()){}
  private async access(session:TenantSession,p:Principal,boardId:string,write:boolean){
    const result=await session.query<{owner_id:string;archived:boolean;role:string|null}>(`SELECT b.owner_id,b.archived,CASE WHEN b.owner_id=$3 THEN 'owner' ELSE m.role END AS role FROM whiteboards b LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$3 WHERE b.org_id=$1 AND b.id=$2 FOR UPDATE OF b`,[p.orgId,boardId,p.userId]);
    const row=result.rows[0],role=C.BoardRole.safeParse(row?.role);if(!row||!role.success)throw new WhiteboardCollaborationError("NOT_FOUND");
    if(row.archived)throw new WhiteboardCollaborationError("ARCHIVED");
    if(write&&role.data==="viewer")throw new WhiteboardCollaborationError("FORBIDDEN");
    return role.data;
  }
  async list(p:Principal,boardId:string){assertPrincipal(p);C.BoardId.parse(boardId);return this.db.withTenant(p.orgId,async session=>{const role=await this.access(session,p,boardId,false);const rows=await session.query<{payload:unknown}>(`SELECT payload FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 AND status<>'object-deleted' ORDER BY created_at,id`,[p.orgId,boardId]);return disclose(boardId,role,"read",rows.rows).map(row=>WhiteboardCommentThread.parse(row.payload));});}
  async dispatch(p:Principal,boardId:string,raw:CommentCommand){
    assertPrincipal(p);C.BoardId.parse(boardId);const command=WhiteboardCommentCommand.parse(raw),requestHash=hash(command);
    return this.db.withTenant(p.orgId,async session=>{
      const role=await this.access(session,p,boardId,true);
      const replay=await session.query<{request_hash:string;response:unknown}>(`SELECT request_hash,response FROM whiteboard_comment_requests WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND request_id=$4`,[p.orgId,boardId,p.userId,command.requestId]);
      if(replay.rows[0]){const previous=disclose(boardId,role,"comment",replay.rows[0]);if(previous.request_hash!==requestHash)throw new WhiteboardCollaborationError("IDEMPOTENCY_CONFLICT");return {...(previous.response as ReturnType<WhiteboardCommentService["dispatch"]>),replayed:true};}
      const document=await session.query<{snapshot:Buffer}>(`SELECT snapshot FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2`,[p.orgId,boardId]);
      const objectIds=new Set(await this.validator.objectIds(new Uint8Array(disclose(boardId,role,"comment",document.rows[0]?.snapshot??Buffer.from([0,0])))));
      const members=await session.query<{user_id:string}>(`SELECT user_id FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 UNION SELECT owner_id AS user_id FROM whiteboards WHERE org_id=$1 AND id=$2`,[p.orgId,boardId]);
      const mentionable=new Set(disclose(boardId,role,"comment",members.rows).map(row=>row.user_id));
      const stored=await session.query<{payload:unknown}>(`SELECT payload FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 ORDER BY id FOR UPDATE`,[p.orgId,boardId]);
      const service=new WhiteboardCommentService(boardId,{objectExists:id=>objectIds.has(id),isMentionable:id=>mentionable.has(id),now:this.now,uuid:randomUUID},disclose(boardId,role,"comment",stored.rows).map(row=>WhiteboardCommentThread.parse(row.payload)));
      let accepted;try{accepted=service.dispatch({actorId:p.userId,role},command);}catch(error){const code=error instanceof Error?error.message:"VALIDATION_FAILED";throw new WhiteboardCollaborationError(["IDEMPOTENCY_CONFLICT","COMMENT_CONFLICT","INVALID_MENTION","FORBIDDEN"].includes(code)?code as "IDEMPOTENCY_CONFLICT"|"COMMENT_CONFLICT"|"INVALID_MENTION"|"FORBIDDEN":"VALIDATION_FAILED");}
      for(const thread of accepted.threads)await session.query(`INSERT INTO whiteboard_comment_threads(org_id,board_id,id,object_id,status,revision,payload,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,now(),now()) ON CONFLICT(org_id,board_id,id) DO UPDATE SET object_id=EXCLUDED.object_id,status=EXCLUDED.status,revision=EXCLUDED.revision,payload=EXCLUDED.payload,updated_at=now()`,[p.orgId,boardId,thread.id,thread.objectId,thread.status,thread.revision,JSON.stringify(thread)]);
      for(const event of accepted.events)await session.query(`INSERT INTO whiteboard_collaboration_events(org_id,board_id,event_id,actor_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[p.orgId,boardId,event.eventId,p.userId,event.type,JSON.stringify(event satisfies WhiteboardCollaborationEvent)]);
      await session.query(`INSERT INTO whiteboard_comment_requests(org_id,board_id,actor_id,request_id,request_hash,response) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[p.orgId,boardId,p.userId,command.requestId,requestHash,JSON.stringify(accepted)]);
      return accepted;
    });
  }
}
