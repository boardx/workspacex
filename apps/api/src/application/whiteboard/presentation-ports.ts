import type {WhiteboardPresentationState} from '@repo/contracts/whiteboard-operation';import type {Principal} from '../../domain/principal';import type {TenantSession} from '../ports/database.port';
export interface WhiteboardPresentationRepository{
 load(session:TenantSession,principal:Principal,boardId:string,roomId:string,lock:boolean):Promise<WhiteboardPresentationState|null>;
 save(session:TenantSession,principal:Principal,state:WhiteboardPresentationState):Promise<void>;
 join(session:TenantSession,principal:Principal,boardId:string,input:{roomId:string;deviceId:string;deviceKind:'personal'|'meeting-display';reconnectToken:string|null},token:string):Promise<{actorId:string;connectionRevision:number}>;
 canTarget(session:TenantSession,principal:Principal,boardId:string,roomId:string,actorId:string):Promise<boolean>;
}
