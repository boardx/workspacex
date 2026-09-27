import { createHash, randomUUID } from 'node:crypto';
import {
  WhiteboardObjectsQuery, WhiteboardObjectsSnapshot, WhiteboardArtifactHandoff, WhiteboardEventCursor, WhiteboardOperationRequest, WhiteboardOperationReceipt,
  type WhiteboardOperationEvent as Event, type WhiteboardOperationReceipt as Receipt,
} from '@repo/contracts/whiteboard-operation';
import type { WhiteboardCommand } from '@repo/contracts/whiteboard-document';
import type { Principal } from '../../domain/principal';
import type { DatabasePort } from '../ports/database.port';
import type { TenantSession } from '../ports/database.port';
import type {ObjectStore} from '../artifact/ports';
import {artifactSourceMatchesLayout} from '../../domain/whiteboard/artifact-layout-source-verifier';
import { WhiteboardCollaborationError, type WhiteboardCollaborationStore, type WhiteboardUpdateValidator } from './collaboration-ports';
import type { RegisteredBoardActor, WhiteboardOperationAuditRepository } from './operation-ports';
import {renderedLayoutToCommands} from '@repo/whiteboard-core';

export const WHITEBOARD_OPERATION_SERVICE = Symbol('WhiteboardOperationService');
export class WhiteboardOperationError extends Error {
  constructor(readonly code: 'FORBIDDEN'|'STALE_REVISION'|'IDEMPOTENCY_CONFLICT'|'NOT_FOUND'|'VALIDATION_FAILED'|'ARCHIVED'|'RATE_LIMITED'|'DEPENDENCY_UNAVAILABLE') { super(code); }
}
export type WhiteboardRateLimitedEntry='operation'|'artifact-handoff'|'events'|'objects'|'head'|'proposal-create'|'proposal-read'|'proposal-cancel'|'proposal-confirm'|'room-join'|'presentation-read'|'presentation-command';
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
  constructor(private readonly db:DatabasePort,private readonly collaboration:WhiteboardCollaborationStore,private readonly audit:WhiteboardOperationAuditRepository,private readonly now=()=>new Date(),private readonly objects?:Pick<ObjectStore,'get'>,private readonly validator?:Pick<WhiteboardUpdateValidator,'objects'>){}
  async execute(principal:Principal,boardId:string,untrusted:unknown):Promise<Receipt>{
    const request=WhiteboardOperationRequest.parse(untrusted);
    return this.db.withTenant(principal.orgId,session=>this.executeInTransaction(session,principal,boardId,request));
  }
  async executeInTransaction(session:TenantSession,principal:Principal,boardId:string,untrusted:unknown):Promise<Receipt>{
      const requested=WhiteboardOperationRequest.parse(untrusted);
      if(requested.boardId!==boardId||requested.actor.orgId!==principal.orgId)throw new WhiteboardOperationError('FORBIDDEN');
      const head=await this.audit.lockHead(session,principal,boardId);
      if(!head)throw new WhiteboardOperationError('NOT_FOUND');
      if(head.actorRole==='viewer')throw new WhiteboardOperationError('FORBIDDEN');
      let actor:typeof requested.actor,registered:RegisteredBoardActor|null=null;
      if(requested.actor.kind==='human'){
        if(requested.actor.actorId!==principal.userId||requested.actor.delegatedBy!==null)throw new WhiteboardOperationError('FORBIDDEN');
        actor={kind:'human',actorId:principal.userId,orgId:principal.orgId,role:head.actorRole,scopes:['board:read','board:write','board:present','artifact:read'],delegatedBy:null};
      }else{
        if(requested.actor.delegatedBy!==principal.userId)throw new WhiteboardOperationError('FORBIDDEN');
        registered=await this.audit.resolveActor(session,principal,requested.actor.actorId);
        if(!registered||registered.kind!==requested.actor.kind||!registered.scopes.includes('board:write'))throw new WhiteboardOperationError('FORBIDDEN');
        actor={kind:registered.kind,actorId:registered.actorId,orgId:principal.orgId,role:head.actorRole,scopes:registered.scopes,delegatedBy:registered.delegatedBy};
      }
      const provenance={...requested.provenance,model:registered?.model??null,skill:registered?.skill??null};
      const request=WhiteboardOperationRequest.parse({...requested,actor,provenance});
      if(request.provenance.source==='chat-artifact'&&(!request.provenance.sourceArtifactId||!request.provenance.sourceRevision||!request.provenance.layoutHash||!await this.audit.canReadArtifact(session,principal,request.provenance.sourceArtifactId,request.provenance.sourceRevision,request.provenance.layoutHash)))throw new WhiteboardOperationError('FORBIDDEN');
      const requestHash=hash(request);
      // Authorization is checked before replay disclosure so revoked members cannot
      // recover a prior receipt by retaining its request id.
      const old=await this.audit.replay(session,principal,boardId,request.requestId);
      if(old){if(old.requestHash!==requestHash)throw new WhiteboardOperationError('IDEMPOTENCY_CONFLICT');return WhiteboardOperationReceipt.parse({...old.receipt,replayed:true});}
      if(head.epoch!==request.expectedRevision.epoch||head.seq!==request.expectedRevision.seq)throw new WhiteboardOperationError('STALE_REVISION');
      const ack=await this.collaboration.writeCommandsInTransaction(session,principal,boardId,{epoch:request.expectedRevision.epoch,requestId:request.requestId,commands:request.commands,actorId:actor.actorId}).catch(error=>collaborationError(error));
      const operationId=randomUUID(),event:Event={eventId:randomUUID(),operationId,requestId:request.requestId,boardId,
        type:eventType(request.commands,request.provenance.source),actor:request.actor,objectIds:objectIds(request.commands),revision:{epoch:ack.epoch,seq:ack.seq},occurredAt:this.now().toISOString(),provenance:request.provenance};
      const receipt=WhiteboardOperationReceipt.parse({operationId,requestId:request.requestId,boardId,revision:event.revision,replayed:false,events:[event]});
      await this.audit.append(session,principal,{requestHash,receipt,event});
      return receipt;
  }
  async events(principal:Principal,boardId:string,untrusted:unknown){
    const cursor=WhiteboardEventCursor.parse(untrusted);
    return this.db.withTenant(principal.orgId,async session=>{
      if(!await this.audit.canRead(session,principal,boardId))throw new WhiteboardOperationError('NOT_FOUND');
      const events=await this.audit.events(session,principal,boardId,cursor.afterSeq,cursor.limit);
      return{boardId,events,nextSeq:events.at(-1)?.revision.seq??cursor.afterSeq};
    });
  }
  async readObjects(principal:Principal,boardId:string,untrusted:unknown):Promise<WhiteboardObjectsSnapshot> {
    const query = WhiteboardObjectsQuery.parse(untrusted);
    return this.db.withTenant(principal.orgId, async session => {
      const actor = await this.audit.resolveActor(session, principal, query.actorId);
      if (!actor || actor.delegatedBy !== principal.userId || !actor.scopes.includes('board:read')) {
        throw new WhiteboardOperationError('FORBIDDEN');
      }
      if (!this.validator) throw new WhiteboardOperationError('DEPENDENCY_UNAVAILABLE');
      // The store checks fresh board membership while holding the board lock,
      // then reads one immutable, integrity-verified snapshot and its revision.
      const snapshot = await this.collaboration.loadInTransaction(session, principal, boardId).catch(collaborationError);
      const objects = await this.validator.objects(snapshot.update).catch(collaborationError);
      return WhiteboardObjectsSnapshot.parse({ boardId, revision: { epoch: snapshot.epoch, seq: snapshot.seq },
        role: snapshot.role, archived: snapshot.archived, objects });
    });
  }
  async head(principal:Principal,boardId:string){return this.db.withTenant(principal.orgId,async session=>{const value=await this.audit.lockHead(session,principal,boardId);if(!value)throw new WhiteboardOperationError('NOT_FOUND');return{epoch:value.epoch,seq:value.seq,role:value.actorRole};});}
  async handoff(principal:Principal,boardId:string,untrusted:unknown){const input=WhiteboardArtifactHandoff.parse(untrusted);if(!this.objects)throw new WhiteboardOperationError('DEPENDENCY_UNAVAILABLE');return this.db.withTenant(principal.orgId,async session=>{const source=await this.audit.readArtifactSource(session,principal,input.layout.artifactId,input.layout.sourceRevision);if(!source)throw new WhiteboardOperationError('FORBIDDEN');let bytes:Uint8Array|null;try{bytes=await this.objects!.get(source.objectKey);}catch{throw new WhiteboardOperationError('DEPENDENCY_UNAVAILABLE');}if(!bytes||createHash('sha256').update(bytes).digest('hex')!==source.contentHash)throw new WhiteboardOperationError('DEPENDENCY_UNAVAILABLE');if(!artifactSourceMatchesLayout(bytes,input.layout))throw new WhiteboardOperationError('FORBIDDEN');const actor={kind:'human' as const,actorId:principal.userId,orgId:principal.orgId,role:'owner' as const,scopes:['board:read' as const,'board:write' as const,'artifact:read' as const],delegatedBy:null};let commands:WhiteboardCommand[];try{commands=renderedLayoutToCommands(input.layout,actor,principal.orgId,input.offset);}catch{throw new WhiteboardOperationError('VALIDATION_FAILED');}await this.audit.issueArtifactLayoutBinding(session,principal,input.layout.artifactId,source.versionId,input.layout.layoutHash);return this.executeInTransaction(session,principal,boardId,{apiVersion:'2026-09-01',requestId:input.requestId,boardId,expectedRevision:input.expectedRevision,actor,commands,provenance:{source:'chat-artifact',model:null,skill:null,sourceArtifactId:input.layout.artifactId,sourceRevision:input.layout.sourceRevision,layoutHash:input.layout.layoutHash,inputObjectIds:[]}});});}
}
