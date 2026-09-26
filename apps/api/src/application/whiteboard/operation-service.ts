import { createHash, randomUUID } from 'node:crypto';
import {
  WhiteboardEventCursor, WhiteboardOperationRequest, WhiteboardOperationReceipt,
  type WhiteboardOperationEvent as Event, type WhiteboardOperationReceipt as Receipt,
} from '@repo/contracts/whiteboard-operation';
import type { WhiteboardCommand } from '@repo/contracts/whiteboard-document';
import type { Principal } from '../../domain/principal';
import type { DatabasePort } from '../ports/database.port';
import { WhiteboardCollaborationError, type WhiteboardCollaborationStore } from './collaboration-ports';
import type { WhiteboardOperationAuditRepository } from './operation-ports';

export const WHITEBOARD_OPERATION_SERVICE = Symbol('WhiteboardOperationService');
export class WhiteboardOperationError extends Error {
  constructor(readonly code: 'FORBIDDEN'|'STALE_REVISION'|'IDEMPOTENCY_CONFLICT'|'NOT_FOUND'|'VALIDATION_FAILED'|'ARCHIVED'|'RATE_LIMITED'|'DEPENDENCY_UNAVAILABLE') { super(code); }
}
function collaborationError(error:unknown):never{
  if(!(error instanceof WhiteboardCollaborationError))throw error;
  const code=error.code==='STALE_EPOCH'?'STALE_REVISION':error.code==='INTEGRITY_FAILED'||error.code==='VALIDATOR_UNAVAILABLE'?'DEPENDENCY_UNAVAILABLE':error.code;
  throw new WhiteboardOperationError(code);
}
const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`:JSON.stringify(value);
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
const objectIds=(commands:readonly WhiteboardCommand[])=>[...new Set(commands.map(command=>command.type==='create'?command.object.id:command.id))];
function eventType(commands:readonly WhiteboardCommand[],source:string):Event['type']{
  if(source==='ai-proposal')return'AIOrganized';
  if(commands.some(c=>c.type==='create'&&c.object.kind==='connector'))return'ConnectorCreated';
  if(commands.some(c=>c.type==='create'&&c.object.kind==='frame'))return'PanelCreated';
  if(commands.every(c=>c.type==='create'))return'ObjectCreated';
  if(commands.every(c=>c.type==='delete'))return'ObjectDeleted';
  if(commands.some(c=>c.type==='parent'))return'ObjectsGrouped';
  if(commands.length>1&&commands.every(c=>c.type==='geometry'))return'ObjectsArranged';
  if(commands.length===1&&commands[0]?.type==='geometry')return'ObjectMoved';
  return'ObjectUpdated';
}

/** Durable public API adapter. The collaboration write, audit receipt and event append share one tenant transaction. */
export class WhiteboardOperationService {
  constructor(private readonly db:DatabasePort,private readonly collaboration:WhiteboardCollaborationStore,private readonly audit:WhiteboardOperationAuditRepository,private readonly now=()=>new Date()){}
  async execute(principal:Principal,boardId:string,untrusted:unknown):Promise<Receipt>{
    const request=WhiteboardOperationRequest.parse(untrusted);
    if(request.boardId!==boardId||request.actor.orgId!==principal.orgId||!request.actor.scopes.includes('board:write'))throw new WhiteboardOperationError('FORBIDDEN');
    if(request.actor.kind==='human'?request.actor.actorId!==principal.userId:request.actor.delegatedBy!==principal.userId)throw new WhiteboardOperationError('FORBIDDEN');
    const requestHash=hash(request);
    return this.db.withTenant(principal.orgId,async session=>{
      const head=await this.audit.lockHead(session,principal,boardId);
      if(!head)throw new WhiteboardOperationError('NOT_FOUND');
      if(head.actorRole==='viewer'||head.actorRole!==request.actor.role)throw new WhiteboardOperationError('FORBIDDEN');
      // Authorization is checked before replay disclosure so revoked members cannot
      // recover a prior receipt by retaining its request id.
      const old=await this.audit.replay(session,principal,boardId,request.requestId);
      if(old){if(old.requestHash!==requestHash)throw new WhiteboardOperationError('IDEMPOTENCY_CONFLICT');return WhiteboardOperationReceipt.parse({...old.receipt,replayed:true});}
      if(head.epoch!==request.expectedRevision.epoch||head.seq!==request.expectedRevision.seq)throw new WhiteboardOperationError('STALE_REVISION');
      const ack=await this.collaboration.writeCommandsInTransaction(session,principal,boardId,{epoch:request.expectedRevision.epoch,requestId:request.requestId,commands:request.commands}).catch(error=>collaborationError(error));
      const operationId=randomUUID(),event:Event={eventId:randomUUID(),operationId,requestId:request.requestId,boardId,
        type:eventType(request.commands,request.provenance.source),actor:request.actor,objectIds:objectIds(request.commands),revision:{epoch:ack.epoch,seq:ack.seq},occurredAt:this.now().toISOString(),provenance:request.provenance};
      const receipt=WhiteboardOperationReceipt.parse({operationId,requestId:request.requestId,boardId,revision:event.revision,replayed:false,events:[event]});
      await this.audit.append(session,principal,{requestHash,receipt,event});
      return receipt;
    });
  }
  async events(principal:Principal,boardId:string,untrusted:unknown){
    const cursor=WhiteboardEventCursor.parse(untrusted);
    return this.db.withTenant(principal.orgId,async session=>{
      if(!await this.audit.canRead(session,principal,boardId))throw new WhiteboardOperationError('NOT_FOUND');
      const events=await this.audit.events(session,principal,boardId,cursor.afterSeq,cursor.limit);
      return{boardId,events,nextSeq:events.at(-1)?.revision.seq??cursor.afterSeq};
    });
  }
}
