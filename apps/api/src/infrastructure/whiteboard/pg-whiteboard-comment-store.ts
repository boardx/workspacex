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
import { decideWhiteboardAccess, unionWhiteboardRole } from "../../domain/whiteboard/access-decision";
import { NO_PROJECT_WHITEBOARD_ACCESS, type WhiteboardProjectAccess } from "../../application/whiteboard/project-access";

const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function disclose<T>(boardId:string,role:C.Board['role'],action:"read"|"comment",payload:T):T {const result=discloseDecided(guard({kind:"whiteboard",id:boardId},payload),decideWhiteboardAccess({decisionId:`whiteboard:${boardId}:${action}`,role,action}));if(!isDisclosed(result))throw new WhiteboardCollaborationError("FORBIDDEN");return result.payload;}

export class PgWhiteboardCommentStore implements WhiteboardCommentStore {
  constructor(private readonly db:DatabasePort,private readonly validator:WhiteboardUpdateValidator,private readonly now:()=>Date=()=>new Date(),private readonly projectAccess:WhiteboardProjectAccess=NO_PROJECT_WHITEBOARD_ACCESS){}
  private async access(session:TenantSession,p:Principal,boardId:string,write:boolean){
    // Lock before reading membership: a join in this statement would retain the
    // snapshot from before a concurrent member revocation released the board lock.
    const result=await session.query<{owner_id:string;archived:boolean}>(`SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE`,[p.orgId,boardId]);
    const row=result.rows[0];if(!row)throw new WhiteboardCollaborationError("NOT_FOUND");
    const members=row.owner_id===p.userId?null:await session.query<{role:string}>(`SELECT role FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 AND user_id=$3`,[p.orgId,boardId,p.userId]);
    const own=row.owner_id===p.userId?'owner':members?.rows[0]?.role;
    // #4615: project source (resolveProjectLayer, same transaction), unioned with the board ACL.
    const borrowed=own==='owner'||own==='editor'?null:await this.projectAccess.roleIn(session,{userId:p.userId,orgId:p.orgId,boardId});
    const parsed=C.BoardRole.safeParse(own??borrowed);
    const role=parsed.success?{success:true as const,data:unionWhiteboardRole(parsed.data,borrowed)??parsed.data}:parsed;
    if(!role.success)throw new WhiteboardCollaborationError("NOT_FOUND");
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
      const members=await session.query<{user_id:string}>(`SELECT om.user_id FROM org_memberships om WHERE om.org_id=$1
        AND (EXISTS (SELECT 1 FROM whiteboard_members m WHERE m.org_id=$1 AND m.board_id=$2 AND m.user_id=om.user_id)
          OR EXISTS (SELECT 1 FROM whiteboards b WHERE b.org_id=$1 AND b.id=$2 AND b.owner_id=om.user_id))
        ORDER BY om.user_id FOR SHARE OF om`,[p.orgId,boardId]);
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
