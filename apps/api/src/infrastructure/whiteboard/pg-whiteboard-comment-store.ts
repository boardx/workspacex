import { createHash, randomUUID } from "node:crypto";
import { whiteboard as C } from "@repo/contracts";
import { whiteboardCollaborationOperations as CommentOperations, WhiteboardCommentCommand, WhiteboardCommentThread, type WhiteboardCollaborationEvent, type WhiteboardCommentCommand as CommentCommand } from "@repo/contracts/whiteboard-collaboration";
import { WhiteboardCommentService } from "@repo/whiteboard-core";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type { WhiteboardCommentStore, WhiteboardUpdateValidator, WhiteboardCollaborationStore } from "../../application/whiteboard/collaboration-ports";
import { WhiteboardCollaborationError } from "../../application/whiteboard/collaboration-ports";
import type { Principal } from "../../domain/principal";
import { assertPrincipal } from "../../domain/principal";
import { discloseDecided,guard,isDisclosed } from "../../application/security/permission-filter";
import { decideWhiteboardAccess } from "../../domain/whiteboard/access-decision";

import { CommentBackupDescriptorSchema, CommentBodyStorage, type CommentObjects, type CommentBlobRef, type CommentThreadMetadata, type CommentBackupDescriptor } from './comment-body-storage';
type StoredThread={id:string;object_id:string|null;status:WhiteboardCommentThread['status'];revision:number;payload:unknown;body_object_key:string|null;body_hash:string|null;body_bytes:string|null};
type StoredResponse={actor_id:string;request_id:string;response:unknown;response_object_key:string|null;response_hash:string|null;response_bytes:string|null};
const threadColumns='id,object_id,status,revision,payload,body_object_key,body_hash,body_bytes::text';
const responseColumns='actor_id,request_id,response,response_object_key,response_hash,response_bytes::text';
const bodyRef=(row:StoredThread):CommentBlobRef=>({key:row.body_object_key!,hash:row.body_hash!,bytes:Number(row.body_bytes),mime:'application/json'});
const responseRef=(row:StoredResponse):CommentBlobRef=>({key:row.response_object_key!,hash:row.response_hash!,bytes:Number(row.response_bytes),mime:'application/json'});
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function disclose<T>(boardId:string,role:C.Board['role'],action:"read"|"comment",payload:T):T {const result=discloseDecided(guard({kind:"whiteboard",id:boardId},payload),decideWhiteboardAccess({decisionId:`whiteboard:${boardId}:${action}`,role,action}));if(!isDisclosed(result))throw new WhiteboardCollaborationError("FORBIDDEN");return result.payload;}

export class PgWhiteboardCommentStore implements WhiteboardCommentStore {
  private readonly bodies:CommentBodyStorage;
  constructor(private readonly db:DatabasePort,private readonly validator:WhiteboardUpdateValidator,private readonly now:()=>Date=()=>new Date(),private readonly collaboration?:WhiteboardCollaborationStore,objects?:CommentObjects){this.bodies=new CommentBodyStorage(objects);}
  private async access(session:TenantSession,p:Principal,boardId:string,write:boolean){
    const result=await session.query<{owner_id:string;archived:boolean;role:string|null}>(`SELECT b.owner_id,b.archived,CASE WHEN b.owner_id=$3 THEN 'owner' ELSE m.role END AS role FROM whiteboards b LEFT JOIN whiteboard_members m ON m.org_id=b.org_id AND m.board_id=b.id AND m.user_id=$3 WHERE b.org_id=$1 AND b.id=$2 FOR UPDATE OF b`,[p.orgId,boardId,p.userId]);
    const row=result.rows[0],role=C.BoardRole.safeParse(row?.role);if(!row||!role.success)throw new WhiteboardCollaborationError("NOT_FOUND");
    if(row.archived)throw new WhiteboardCollaborationError("ARCHIVED");
    if(write&&role.data==="viewer")throw new WhiteboardCollaborationError("FORBIDDEN");
    return role.data;
  }
  private async readThread(session:TenantSession,p:Principal,boardId:string,row:StoredThread):Promise<WhiteboardCommentThread>{
    let thread:WhiteboardCommentThread;
    if(row.body_object_key) thread=await this.bodies.hydrate(p,boardId,row.payload as CommentThreadMetadata,bodyRef(row));
    else {thread=WhiteboardCommentThread.parse(row.payload);const stored=await this.bodies.split(p,boardId,thread);await session.query(`UPDATE whiteboard_comment_threads SET payload=$4::jsonb,body_object_key=$5,body_hash=$6,body_bytes=$7 WHERE org_id=$1 AND board_id=$2 AND id=$3 AND body_object_key IS NULL`,[p.orgId,boardId,row.id,JSON.stringify(stored.metadata),stored.blob.key,stored.blob.hash,stored.blob.bytes]);}
    if(thread.id!==row.id||thread.objectId!==row.object_id||thread.revision!==row.revision||thread.status!==row.status)throw new WhiteboardCollaborationError('INTEGRITY_FAILED');
    return thread;
  }
  private async readResponse(session:TenantSession,p:Principal,boardId:string,row:StoredResponse){
    const parsed=CommentOperations.dispatchComment.out.safeParse(row.response_object_key?await this.bodies.read(p,boardId,responseRef(row),'comment-responses'):row.response);if(!parsed.success)throw new WhiteboardCollaborationError('INTEGRITY_FAILED');const accepted=parsed.data;
    if(accepted.threads.some(thread=>thread.boardId!==boardId||thread.comments.some(comment=>comment.boardId!==boardId||comment.threadId!==thread.id))||accepted.events.some(event=>event.boardId!==boardId))throw new WhiteboardCollaborationError('INTEGRITY_FAILED');
    if(!row.response_object_key){const ref=await this.bodies.write(p,boardId,'comment-responses',accepted);await session.query(`UPDATE whiteboard_comment_requests SET response=NULL,response_object_key=$5,response_hash=$6,response_bytes=$7 WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND request_id=$4 AND response_object_key IS NULL`,[p.orgId,boardId,row.actor_id,row.request_id,ref.key,ref.hash,ref.bytes]);}
    return accepted;
  }
  /** Authenticated lazy migration also clears old idempotency receipts; no PG body copy remains. */
  async migrateLegacyInTransaction(session:TenantSession,p:Principal,boardId:string):Promise<void>{
    assertPrincipal(p);C.BoardId.parse(boardId);await this.access(session,p,boardId,false);
    const threads=await session.query<StoredThread>(`SELECT ${threadColumns} FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 AND body_object_key IS NULL ORDER BY id FOR UPDATE`,[p.orgId,boardId]);
    for(const row of threads.rows)await this.readThread(session,p,boardId,row);
    const requests=await session.query<StoredResponse>(`SELECT ${responseColumns} FROM whiteboard_comment_requests WHERE org_id=$1 AND board_id=$2 AND response_object_key IS NULL`,[p.orgId,boardId]);
    for(const row of requests.rows)await this.readResponse(session,p,boardId,row);
  }
  async captureBackupInTransaction(session:TenantSession,p:Principal,boardId:string):Promise<CommentBackupDescriptor[]>{
    await this.migrateLegacyInTransaction(session,p,boardId);
    const rows=await session.query<StoredThread>(`SELECT ${threadColumns} FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 ORDER BY id FOR UPDATE`,[p.orgId,boardId]);
    const result:CommentBackupDescriptor[]=[];
    for(const row of rows.rows){await this.readThread(session,p,boardId,row);result.push({id:row.id,objectId:row.object_id,status:row.status,revision:row.revision,metadata:row.payload as CommentThreadMetadata,blob:bodyRef(row)});}return result;
  }
  /** Caller first copies verified blobs to the target board prefix. Only fresh empty targets qualify. */
  async restoreBackupInTransaction(session:TenantSession,p:Principal,targetBoardId:string,descriptors:readonly CommentBackupDescriptor[]):Promise<void>{
    assertPrincipal(p);C.BoardId.parse(targetBoardId);const role=await this.access(session,p,targetBoardId,true);if(role!=='owner')throw new WhiteboardCollaborationError('FORBIDDEN');
    const existing=await session.query(`SELECT id FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 LIMIT 1`,[p.orgId,targetBoardId]);if(existing.rows.length)throw new WhiteboardCollaborationError('COMMENT_CONFLICT');
    if(new Set(descriptors.map(descriptor=>descriptor.id)).size!==descriptors.length)throw new WhiteboardCollaborationError('INTEGRITY_FAILED');
    for(const rawDescriptor of descriptors){
      const descriptor=CommentBackupDescriptorSchema.parse(rawDescriptor);
      const metadata={...descriptor.metadata,boardId:targetBoardId,comments:descriptor.metadata.comments.map(comment=>({...comment,boardId:targetBoardId}))};
      const thread=await this.bodies.hydrate(p,targetBoardId,metadata,descriptor.blob);
      if(thread.id!==descriptor.id||thread.objectId!==descriptor.objectId||thread.status!==descriptor.status||thread.revision!==descriptor.revision)throw new WhiteboardCollaborationError('INTEGRITY_FAILED');
      await this.saveThread(session,p,targetBoardId,thread);
    }
  }
  private async saveThread(session:TenantSession,p:Principal,boardId:string,thread:WhiteboardCommentThread){
    const {metadata,blob}=await this.bodies.split(p,boardId,thread);
    await session.query(`INSERT INTO whiteboard_comment_threads(org_id,board_id,id,object_id,status,revision,payload,body_object_key,body_hash,body_bytes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,now(),now()) ON CONFLICT(org_id,board_id,id) DO UPDATE SET object_id=EXCLUDED.object_id,status=EXCLUDED.status,revision=EXCLUDED.revision,payload=EXCLUDED.payload,body_object_key=EXCLUDED.body_object_key,body_hash=EXCLUDED.body_hash,body_bytes=EXCLUDED.body_bytes,updated_at=now()`,[p.orgId,boardId,thread.id,thread.objectId,thread.status,thread.revision,JSON.stringify(metadata),blob.key,blob.hash,blob.bytes]);
  }
  async list(p:Principal,boardId:string){assertPrincipal(p);C.BoardId.parse(boardId);return this.db.withTenant(p.orgId,async session=>{const role=await this.access(session,p,boardId,false);await this.migrateLegacyInTransaction(session,p,boardId);const rows=await session.query<StoredThread>(`SELECT ${threadColumns} FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 AND status<>'object-deleted' ORDER BY created_at,id`,[p.orgId,boardId]);const result:WhiteboardCommentThread[]=[];for(const row of disclose(boardId,role,'read',rows.rows))result.push(await this.readThread(session,p,boardId,row));return result;});}
  async dispatch(p:Principal,boardId:string,raw:CommentCommand){
    assertPrincipal(p);C.BoardId.parse(boardId);const command=WhiteboardCommentCommand.parse(raw),requestHash=hash(command);
    return this.db.withTenant(p.orgId,async session=>{
      const role=await this.access(session,p,boardId,true);
      await this.migrateLegacyInTransaction(session,p,boardId);
      const replay=await session.query<StoredResponse & {request_hash:string}>(`SELECT request_hash,${responseColumns} FROM whiteboard_comment_requests WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND request_id=$4`,[p.orgId,boardId,p.userId,command.requestId]);
      if(replay.rows[0]){const previous=disclose(boardId,role,"comment",replay.rows[0]);if(previous.request_hash!==requestHash)throw new WhiteboardCollaborationError("IDEMPOTENCY_CONFLICT");return {...await this.readResponse(session,p,boardId,previous),replayed:true};}
      let snapshot:Uint8Array;
      if(this.collaboration) snapshot=(await this.collaboration.loadInTransaction(session,p,boardId)).update;
      else {
        const document=await session.query<{snapshot:Buffer|null;object_key:string|null}>(`SELECT snapshot,object_key FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2`,[p.orgId,boardId]);
        if(document.rows[0]?.object_key)throw new WhiteboardCollaborationError('DEPENDENCY_UNAVAILABLE');
        snapshot=new Uint8Array(document.rows[0]?.snapshot??Buffer.from([0,0]));
      }
      const objectIds=new Set(await this.validator.objectIds(disclose(boardId,role,"comment",snapshot)));
      const members=await session.query<{user_id:string}>(`SELECT user_id FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 UNION SELECT owner_id AS user_id FROM whiteboards WHERE org_id=$1 AND id=$2`,[p.orgId,boardId]);
      const mentionable=new Set(disclose(boardId,role,"comment",members.rows).map(row=>row.user_id));
      const stored=await session.query<StoredThread>(`SELECT ${threadColumns} FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 ORDER BY id FOR UPDATE`,[p.orgId,boardId]);
      const service=new WhiteboardCommentService(boardId,{objectExists:id=>objectIds.has(id),isMentionable:id=>mentionable.has(id),now:this.now,uuid:randomUUID},await Promise.all(disclose(boardId,role,"comment",stored.rows).map(row=>this.readThread(session,p,boardId,row))));
      let accepted;try{accepted=service.dispatch({actorId:p.userId,role},command);}catch(error){const code=error instanceof Error?error.message:"VALIDATION_FAILED";throw new WhiteboardCollaborationError(["IDEMPOTENCY_CONFLICT","COMMENT_CONFLICT","INVALID_MENTION","FORBIDDEN"].includes(code)?code as "IDEMPOTENCY_CONFLICT"|"COMMENT_CONFLICT"|"INVALID_MENTION"|"FORBIDDEN":"VALIDATION_FAILED");}
      for(const thread of accepted.threads)await this.saveThread(session,p,boardId,thread);
      for(const event of accepted.events)await session.query(`INSERT INTO whiteboard_collaboration_events(org_id,board_id,event_id,actor_id,event_type,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[p.orgId,boardId,event.eventId,p.userId,event.type,JSON.stringify(event satisfies WhiteboardCollaborationEvent)]);
      const receipt=await this.bodies.write(p,boardId,'comment-responses',accepted);
      await session.query(`INSERT INTO whiteboard_comment_requests(org_id,board_id,actor_id,request_id,request_hash,response,response_object_key,response_hash,response_bytes) VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8)`,[p.orgId,boardId,p.userId,command.requestId,requestHash,receipt.key,receipt.hash,receipt.bytes]);
      return accepted;
    });
  }
}
