import type {WhiteboardOperationReceipt} from '@repo/contracts/whiteboard-operation';
import type {Principal} from '../../domain/principal';
import type {TenantSession} from '../ports/database.port';
export type UndoCommentState={id:string;status:string;revision:number};
export type OperationBeforeReference={epoch:number;seq:number;key:string;hash:string;bytes:number;comments:UndoCommentState[]};
export type StoredOperationUndo={ownerUserId:string;undoId:string;receipt:WhiteboardOperationReceipt;before:OperationBeforeReference};
export interface WhiteboardOperationUndoStore{
 capture(session:TenantSession,p:Principal,boardId:string):Promise<OperationBeforeReference>;
 record(session:TenantSession,p:Principal,receipt:WhiteboardOperationReceipt,before:OperationBeforeReference):Promise<void>;
 get(session:TenantSession,p:Principal,boardId:string,operationId:string):Promise<StoredOperationUndo|null>;
 readBefore(p:Principal,boardId:string,value:OperationBeforeReference):Promise<Uint8Array>;
 checkComments(session:TenantSession,p:Principal,boardId:string,value:OperationBeforeReference):Promise<void>;
 restoreComments(session:TenantSession,p:Principal,boardId:string,value:OperationBeforeReference):Promise<void>;
}
