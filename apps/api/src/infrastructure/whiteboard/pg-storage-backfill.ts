import type {DatabasePort,TenantSession} from '../../application/ports/database.port';
import type {Principal} from '../../domain/principal';
import type {LegacyBodyCounts,StorageBackfillPort} from '../../application/whiteboard/storage-backfill';
import type {PgWhiteboardCollaborationStore} from './pg-collaboration-store';
import type {PgWhiteboardCommentStore} from './pg-whiteboard-comment-store';
import {lockBoardStorageMaintenance} from './storage-maintenance-access';
export class PgStorageBackfill implements StorageBackfillPort{
 constructor(private readonly db:DatabasePort,private readonly collaboration:Pick<PgWhiteboardCollaborationStore,'backfillStorageInTransaction'>,private readonly comments:Pick<PgWhiteboardCommentStore,'backfillStorageInTransaction'>){}
 private async counts(s:TenantSession,p:Principal,id:string):Promise<LegacyBodyCounts>{
  const result=await s.query<{snapshots:string;updates:string;threads:string;receipts:string}>(`SELECT
   (SELECT count(*) FROM whiteboard_documents WHERE org_id=$1 AND board_id=$2 AND snapshot IS NOT NULL)::text snapshots,
   (SELECT count(*) FROM whiteboard_updates WHERE org_id=$1 AND board_id=$2 AND update IS NOT NULL)::text updates,
   (SELECT count(*) FROM whiteboard_comment_threads WHERE org_id=$1 AND board_id=$2 AND body_object_key IS NULL)::text threads,
   (SELECT count(*) FROM whiteboard_comment_requests WHERE org_id=$1 AND board_id=$2 AND response_object_key IS NULL)::text receipts`,[p.orgId,id]);
  const row=result.rows[0]!;return {snapshots:Number(row.snapshots),updates:Number(row.updates),commentThreads:Number(row.threads),commentReceipts:Number(row.receipts)};
 }
 async list(p:Principal,after:string|null,limit:number){return this.db.withTenant(p.orgId,async s=>{await lockBoardStorageMaintenance(s,p);const result=await s.query<{id:string}>(`SELECT id FROM whiteboards WHERE org_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3`,[p.orgId,after,limit]);return result.rows.map(row=>row.id);});}
 async inspect(p:Principal,id:string){return this.db.withTenant(p.orgId,async s=>({...await lockBoardStorageMaintenance(s,p,id),remaining:await this.counts(s,p,id)}));}
 async migrate(p:Principal,id:string,maxRows:number){return this.db.withTenant(p.orgId,async s=>{const access=await lockBoardStorageMaintenance(s,p,id);let migrated=await this.collaboration.backfillStorageInTransaction(s,p,id,maxRows);if(migrated<maxRows)migrated+=await this.comments.backfillStorageInTransaction(s,p,id,maxRows-migrated);return {...access,migrated,remaining:await this.counts(s,p,id)};});}
}
