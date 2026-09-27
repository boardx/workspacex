import { createHash } from 'node:crypto';
import { WhiteboardCommentThread, WHITEBOARD_COLLABORATION_LIMITS } from '@repo/contracts/whiteboard-collaboration';
import { ObjectExistsError, type ObjectStore } from '../../application/artifact/ports';
import { WhiteboardCollaborationError as Fault } from '../../application/whiteboard/collaboration-ports';
import type { Principal } from '../../domain/principal';

type Thread = WhiteboardCommentThread;
export { CommentThreadMetadataSchema,CommentBackupDescriptorSchema } from '../../application/whiteboard/comment-backup-contract';
export type { CommentThreadMetadata,CommentBackupDescriptor,CommentBlobRef } from '../../application/whiteboard/comment-backup-contract';
import { CommentThreadMetadataSchema,type CommentThreadMetadata,type CommentBlobRef } from '../../application/whiteboard/comment-backup-contract';
export type CommentObjects = Pick<ObjectStore,'putOnce'|'get'|'head'>;
const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export const commentObjectPrefix=(p:Principal,boardId:string)=>`whiteboards/tenants/${digest(p.orgId).slice(0,32)}/boards/${boardId}`;

/** Body maps have no boardId, so verified backup bytes can be copied unchanged to a new board. */
export class CommentBodyStorage {
  constructor(private readonly objects:CommentObjects|undefined){}
  async write(p:Principal,boardId:string,kind:'comment-bodies'|'comment-responses',value:unknown):Promise<CommentBlobRef>{
    if(!this.objects)throw new Fault('DEPENDENCY_UNAVAILABLE');
    const bytes=Buffer.from(JSON.stringify(value)),hash=digest(bytes);
    if(bytes.byteLength>WHITEBOARD_COLLABORATION_LIMITS.checkpointBytes)throw new Fault('VALIDATION_FAILED');
    const ref:CommentBlobRef={key:`${commentObjectPrefix(p,boardId)}/${kind}/${hash}.json`,hash,bytes:bytes.byteLength,mime:'application/json'};
    try{await this.objects.putOnce(ref.key,bytes,ref.mime);}catch(error){if(!(error instanceof ObjectExistsError))throw new Fault('DEPENDENCY_UNAVAILABLE');}
    await this.read(p,boardId,ref,kind);return ref;
  }
  async read(p:Principal,boardId:string,ref:CommentBlobRef,kind:'comment-bodies'|'comment-responses'):Promise<unknown>{
    if(!this.objects)throw new Fault('DEPENDENCY_UNAVAILABLE');
    if(!/^[a-f0-9]{64}$/.test(ref.hash)||ref.key!==`${commentObjectPrefix(p,boardId)}/${kind}/${ref.hash}.json`||ref.mime!=='application/json'||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>WHITEBOARD_COLLABORATION_LIMITS.checkpointBytes)throw new Fault('INTEGRITY_FAILED');
    let bytes:Uint8Array|null,head:{sizeBytes:number;mime:string}|null;
    try{[bytes,head]=await Promise.all([this.objects.get(ref.key),this.objects.head(ref.key)]);}catch{throw new Fault('DEPENDENCY_UNAVAILABLE');}
    if(!bytes||!head||bytes.byteLength!==ref.bytes||head.sizeBytes!==ref.bytes||head.mime!==ref.mime||digest(bytes)!==ref.hash)throw new Fault('INTEGRITY_FAILED');
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Fault('INTEGRITY_FAILED');}
  }
  async split(p:Principal,boardId:string,raw:Thread):Promise<{metadata:CommentThreadMetadata;blob:CommentBlobRef}>{
    const thread=WhiteboardCommentThread.parse(raw);
    if(thread.boardId!==boardId||thread.comments.some(comment=>comment.boardId!==boardId||comment.threadId!==thread.id))throw new Fault('INTEGRITY_FAILED');
    const bodies=Object.fromEntries(thread.comments.map(comment=>[comment.id,comment.body]));
    const metadata={...thread,comments:thread.comments.map(({body:_,...comment})=>comment)};
    return{metadata,blob:await this.write(p,boardId,'comment-bodies',{version:1,bodies})};
  }
  async hydrate(p:Principal,boardId:string,metadata:CommentThreadMetadata,blob:CommentBlobRef):Promise<Thread>{
    if(!CommentThreadMetadataSchema.safeParse(metadata).success)throw new Fault('INTEGRITY_FAILED');
    const value=await this.read(p,boardId,blob,'comment-bodies') as {version?:unknown;bodies?:Record<string,unknown>};
    try{
      if(value.version!==1||!value.bodies||Array.isArray(value.bodies)||Object.keys(value.bodies).length!==metadata.comments.length)throw new Error();
      const thread=WhiteboardCommentThread.parse({...metadata,comments:metadata.comments.map(comment=>({...comment,body:value.bodies![comment.id]}))});
      if(thread.boardId!==boardId||thread.comments.some(comment=>comment.boardId!==boardId||comment.threadId!==thread.id))throw new Error();
      return thread;
    }catch{throw new Fault('INTEGRITY_FAILED');}
  }
}
