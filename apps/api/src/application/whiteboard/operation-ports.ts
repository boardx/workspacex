import type { WhiteboardOperationEvent, WhiteboardOperationReceipt } from '@repo/contracts/whiteboard-operation';
import type { Principal } from '../../domain/principal';
import type { TenantSession } from '../ports/database.port';

export interface WhiteboardOperationHead { epoch:number;seq:number;actorRole:'owner'|'editor'|'viewer' }
export interface RegisteredBoardActor { actorId:string;kind:'service'|'ai';delegatedBy:string;scopes:('board:read'|'board:write'|'board:present'|'artifact:read')[];model:string|null;skill:string|null }
export interface WhiteboardOperationAuditRepository {
  replay(session:TenantSession,principal:Principal,boardId:string,requestId:string):Promise<{requestHash:string;receipt:WhiteboardOperationReceipt}|null>;
  lockHead(session:TenantSession,principal:Principal,boardId:string):Promise<WhiteboardOperationHead|null>;
  append(session:TenantSession,principal:Principal,input:{requestHash:string;receipt:WhiteboardOperationReceipt;event:WhiteboardOperationEvent}):Promise<void>;
  canRead(session:TenantSession,principal:Principal,boardId:string):Promise<boolean>;
  events(session:TenantSession,principal:Principal,boardId:string,afterSeq:number,limit:number,afterEpoch?:number):Promise<WhiteboardOperationEvent[]>;
  lockRuntimeActor?(session:TenantSession,principal:Principal,actorId:string):Promise<{actor:RegisteredBoardActor;agentVersionId:string;model:string;skillVersionIds:string[]}|null>;
  resolveActor(session:TenantSession,principal:Principal,actorId:string):Promise<RegisteredBoardActor|null>;
  canReadArtifact(session:TenantSession,principal:Principal,artifactId:string,revision:string,layoutHash:string):Promise<boolean>;
  readArtifactSource(session:TenantSession,principal:Principal,artifactId:string,revision:string):Promise<{versionId:string;objectKey:string;contentHash:string}|null>;
  issueArtifactLayoutBinding(session:TenantSession,principal:Principal,artifactId:string,versionId:string,layoutHash:string):Promise<void>;
}
