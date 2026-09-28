import {canExportOrganization} from '../../domain/auth/org-lifecycle';
import type {TenantSession} from '../../application/ports/database.port';
import type {Principal} from '../../domain/principal';
import {assertPrincipal} from '../../domain/principal';
import {StorageBackfillError} from '../../application/whiteboard/storage-backfill';
export async function lockStorageOperatorMembership(s:TenantSession,p:Principal){
 assertPrincipal(p);const member=await s.query<{org_role:string}>(`SELECT org_role FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE`,[p.orgId,p.userId]);
 if(!member.rows[0])throw new StorageBackfillError('NOT_FOUND');return {administrator:canExportOrganization(member.rows[0].org_role)};
}
/** Maintenance changes storage references only, including archived boards. No content editing privilege. */
export async function lockBoardStorageMaintenance(s:TenantSession,p:Principal,boardId?:string){
 const member=await lockStorageOperatorMembership(s,p);
 if(!boardId){if(!member.administrator)throw new StorageBackfillError('FORBIDDEN');return {archived:false};}
 const board=await s.query<{owner_id:string;archived:boolean}>(`SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE`,[p.orgId,boardId]);
 if(!board.rows[0]||(!member.administrator&&board.rows[0].owner_id!==p.userId))throw new StorageBackfillError('NOT_FOUND');
 return {archived:board.rows[0].archived};
}
