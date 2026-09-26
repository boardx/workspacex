import type { WhiteboardOperationEvent, WhiteboardOperationReceipt } from '@repo/contracts/whiteboard-operation';
import type { Principal } from '../../domain/principal';
import type { TenantSession } from '../ports/database.port';

export interface WhiteboardOperationHead { epoch:number;seq:number;actorRole:'owner'|'editor'|'viewer' }
export interface WhiteboardOperationAuditRepository {
  replay(session:TenantSession,principal:Principal,boardId:string,requestId:string):Promise<{requestHash:string;receipt:WhiteboardOperationReceipt}|null>;
  lockHead(session:TenantSession,principal:Principal,boardId:string):Promise<WhiteboardOperationHead|null>;
  append(session:TenantSession,principal:Principal,input:{requestHash:string;receipt:WhiteboardOperationReceipt;event:WhiteboardOperationEvent}):Promise<void>;
  canRead(session:TenantSession,principal:Principal,boardId:string):Promise<boolean>;
  events(session:TenantSession,principal:Principal,boardId:string,afterSeq:number,limit:number):Promise<WhiteboardOperationEvent[]>;
}
