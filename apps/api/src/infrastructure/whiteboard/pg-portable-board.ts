import {createHash} from 'node:crypto';
import {whiteboard as C} from '@repo/contracts';
import {WHITEBOARD_IMPORT_LIMITS} from '@repo/contracts/whiteboard-import';
import type {PortablePublish,PortableAck} from '../../application/whiteboard/portable-board';
import {portableHash} from '../../application/whiteboard/portable-board';
import type {DatabasePort} from '../../application/ports/database.port';
import type {WhiteboardCollaborationStore} from '../../application/whiteboard/collaboration-ports';
import {WhiteboardImportError as Fault} from '../../application/whiteboard/import-service';
import {ObjectExistsError,type ObjectStore} from '../../application/artifact/ports';
import type {Principal} from '../../domain/principal';
import {PgBoardImageAssets} from './pg-image-assets';
const chunkId=(requestId:string,index:number)=>{const h=createHash('sha256').update(`${requestId}:${index}`).digest('hex');return`${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
export class PgPortableBoard implements PortablePublish {
 constructor(private readonly db:DatabasePort,private readonly collaboration:WhiteboardCollaborationStore,private readonly objects:Pick<ObjectStore,'putOnce'|'get'|'head'>,private readonly assets:PgBoardImageAssets){}
 async publish(p:Principal,boardId:string,input:Parameters<PortablePublish['publish']>[2]):Promise<PortableAck>{
  return this.db.withTenant(p.orgId,async session=>{
   // Lock first, then read membership in a new READ COMMITTED statement snapshot.
   // A revoker may have held this lock while removing membership without changing
   // the board tuple, so a joined lookup in the locking statement is stale.
   const access=await session.query<{owner_id:string;archived:boolean}>(`SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE`,[p.orgId,boardId]);
   const board=access.rows[0];if(!board)throw new Fault('NOT_FOUND');
   const member=board.owner_id===p.userId?null:await session.query<{role:string}>(`SELECT role FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 AND user_id=$3`,[p.orgId,boardId,p.userId]);
   const role=board.owner_id===p.userId?'owner':member?.rows[0]?.role;
   if(!C.BoardRole.safeParse(role).success)throw new Fault('NOT_FOUND');if(!['owner','editor'].includes(role!))throw new Fault('FORBIDDEN');if(board.archived)throw new Fault('ARCHIVED');
   const replay=await session.query<{request_hash:string;epoch:number;seq:string;object_count:number;asset_count:number}>(`SELECT request_hash,epoch,seq::text,object_count,asset_count FROM whiteboard_portable_imports WHERE org_id=$1 AND board_id=$2 AND actor_id=$3 AND request_id=$4`,[p.orgId,boardId,p.userId,input.requestId]);
   if(replay.rows[0]){const row=replay.rows[0];if(row.request_hash!==input.requestHash)throw new Fault('IDEMPOTENCY_CONFLICT');return{epoch:row.epoch,seq:Number(row.seq),objectCount:row.object_count,assetCount:row.asset_count,replayed:true};}
   const records=[];
   for(const image of input.images){const key=`whiteboards/tenants/${portableHash(p.orgId).slice(0,32)}/boards/${boardId}/assets/${image.metadata.contentDigest.slice(7)}`;
    try{await this.objects.putOnce(key,image.bytes,image.metadata.mimeType);}catch(error){if(!(error instanceof ObjectExistsError))throw new Fault('DEPENDENCY_UNAVAILABLE');}
    const [bytes,head]=await Promise.all([this.objects.get(key),this.objects.head(key)]);if(!bytes||!head||head.mime!==image.metadata.mimeType||bytes.length!==image.metadata.byteSize||head.sizeBytes!==bytes.length||`sha256:${portableHash(bytes)}`!==image.metadata.contentDigest)throw new Fault('INTEGRITY_FAILED');records.push({objectKey:key,metadata:image.metadata});
   }
   // All chunks and asset roots share this transaction. No provisional ACK escapes.
   let seq=0;
   for(let offset=0;offset<input.commands.length;offset+=WHITEBOARD_IMPORT_LIMITS.objects){const ack=await this.collaboration.writeCommandsInTransaction(session,p,boardId,{epoch:input.expectedEpoch,requestId:chunkId(input.requestId,offset),commands:input.commands.slice(offset,offset+WHITEBOARD_IMPORT_LIMITS.objects)});seq=ack.seq;}
   for(const record of records)await this.assets.saveInTransaction(session,p,boardId,record);
   await session.query(`INSERT INTO whiteboard_portable_imports(org_id,board_id,actor_id,request_id,request_hash,epoch,seq,object_count,asset_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[p.orgId,boardId,p.userId,input.requestId,input.requestHash,input.expectedEpoch,seq,input.commands.length,input.images.length]);
   return{epoch:input.expectedEpoch,seq,replayed:false,objectCount:input.commands.length,assetCount:input.images.length};
  });
 }
}
