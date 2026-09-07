import {ScheduleNotification,ScheduleNotificationListInput,ScheduleNotificationListOutput,ScheduleNotificationReadInput} from '@repo/contracts/schedule-notifications';
import {SCHEDULE_LIMITS} from '@repo/contracts/standard-schedule';
import type {z} from 'zod';
import type {DatabasePort,TenantSession} from '../../application/ports/database.port';
import type {IdentityRepository} from '../../application/identity/ports';
import type {ScheduledRunNotifier} from '../../application/agent-run/standard-schedule';
import {ScheduleNotificationForbiddenError,ScheduleNotificationNotFoundError,type ScheduleNotifications,type ScheduleNotificationViewer} from '../../application/agent-run/schedule-notifications';
interface Row {id:string;last_occurrence_id:string;failure_code:string;notification_accepted_at:Date;notification_read_at:Date|null;}
/** Uses the scheduler's persisted failure as the notice. publish is an internal
 * receipt transition, while user reads/acks always recheck current membership. */
export class PgScheduleNotifications implements ScheduledRunNotifier,ScheduleNotifications {
 constructor(private readonly db:DatabasePort,private readonly identity:Pick<IdentityRepository,'findOrgMembership'>){}
 private async withViewer<T>(viewer:ScheduleNotificationViewer,consume:(s:TenantSession)=>Promise<T>):Promise<T>{
  return this.db.withTenant(viewer.orgId,async s=>{
   if(!await this.identity.findOrgMembership(viewer.userId,viewer.orgId))throw new ScheduleNotificationForbiddenError();
   return consume(s);
  });
 }
 async publish(input:Parameters<ScheduledRunNotifier['publish']>[0]):Promise<{durablyAccepted:true}>{
  await this.db.withTenant(input.orgId,async s=>{
   const result=await s.query<{id:string}>(`UPDATE standard_schedules SET notification_accepted_at=COALESCE(notification_accepted_at,now())
    WHERE org_id=$1 AND user_id=$2 AND id=$3::uuid AND last_occurrence_id=$4::uuid AND failure_code=$5 AND status='failed' RETURNING id`,
    [input.orgId,input.userId,input.scheduleId,input.factId,input.code]);
   if(result.rows.length!==1)throw new ScheduleNotificationNotFoundError();
  });
  return {durablyAccepted:true};
 }
 async list(viewer:ScheduleNotificationViewer,raw:z.infer<typeof ScheduleNotificationListInput>){
  const input=ScheduleNotificationListInput.parse(raw);
  return this.withViewer(viewer,async s=>{
   const rows=(await s.query<Row>(`SELECT id,last_occurrence_id,failure_code,notification_accepted_at,notification_read_at FROM standard_schedules
    WHERE org_id=$1 AND user_id=$2 AND notification_accepted_at IS NOT NULL AND notification_read_at IS NULL
    AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT $4`,
    [viewer.orgId,viewer.userId,input.cursor??null,SCHEDULE_LIMITS.pageSize+1])).rows;
   const page=rows.slice(0,SCHEDULE_LIMITS.pageSize);
   return ScheduleNotificationListOutput.parse({notifications:page.map(row=>ScheduleNotification.parse({
    factId:row.last_occurrence_id,scheduleId:row.id,code:row.failure_code,
    acceptedAt:row.notification_accepted_at.toISOString(),readAt:row.notification_read_at?.toISOString()??null,
   })),...(rows.length>SCHEDULE_LIMITS.pageSize?{cursor:page.at(-1)!.id}:{})});
  });
 }
 async markRead(viewer:ScheduleNotificationViewer,raw:z.infer<typeof ScheduleNotificationReadInput>):Promise<{read:true}>{
  const input=ScheduleNotificationReadInput.parse(raw);
  return this.withViewer(viewer,async s=>{
   const result=await s.query<{id:string}>(`UPDATE standard_schedules SET notification_read_at=COALESCE(notification_read_at,now())
    WHERE org_id=$1 AND user_id=$2 AND last_occurrence_id=$3::uuid AND notification_accepted_at IS NOT NULL RETURNING id`,
    [viewer.orgId,viewer.userId,input.factId]);
   if(result.rows.length!==1)throw new ScheduleNotificationNotFoundError();
   return {read:true};
  });
 }
}
