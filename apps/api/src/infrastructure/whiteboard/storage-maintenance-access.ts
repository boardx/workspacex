import {canExportOrganization} from '../../domain/auth/org-lifecycle';
import type {TenantSession} from '../../application/ports/database.port';
import type {Principal} from '../../domain/principal';
import {assertPrincipal} from '../../domain/principal';
import {StorageBackfillError} from '../../application/whiteboard/storage-backfill';
/** Maintenance changes storage references only, including archived boards. No content editing privilege. */
export async function lockBoardStorageMaintenance(s:TenantSession,p:Principal,boardId?:string){
 assertPrincipal(p);
 const member=await s.query<{org_role:string}>(`SELECT org_role FROM org_memberships WHERE org_id=$1 AND user_id=$2 FOR SHARE`,[p.orgId,p.userId]);
 if(!member.rows[0])throw new StorageBackfillError('NOT_FOUND');
 if(!boardId){if(!canExportOrganization(member.rows[0].org_role))throw new StorageBackfillError('FORBIDDEN');return {archived:false};}
 const board=await s.query<{owner_id:string;archived:boolean}>(`SELECT owner_id,archived FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE`,[p.orgId,boardId]);
 if(!board.rows[0]||(!canExportOrganization(member.rows[0].org_role)&&board.rows[0].owner_id!==p.userId))throw new StorageBackfillError('NOT_FOUND');
 return {archived:board.rows[0].archived};
}
