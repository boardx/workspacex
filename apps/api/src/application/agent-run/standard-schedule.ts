import type {z} from 'zod';
import type {ScheduleToolRequest,ScheduleItem} from '@repo/contracts/standard-schedule';
import type {OrgId} from '../../domain/org-id';
export const STANDARD_SCHEDULE=Symbol('StandardSchedule');
export const SCHEDULED_RUN_GATEWAY=Symbol('ScheduledRunGateway');
export const SCHEDULED_RUN_NOTIFIER=Symbol('ScheduledRunNotifier');
export interface StandardSchedule {
 invoke(runId:string,input:z.infer<typeof ScheduleToolRequest>):Promise<unknown>;
}
export type ScheduleView=z.infer<typeof ScheduleItem>;
/** Uses the existing Chat command path and the same DatabasePort instance as the scheduler.
 * dispatch must not kick before the caller's outer transaction commits. */
export interface ScheduledRunGateway {
 dispatch(input:{orgId:OrgId;userId:string;threadId:string;agentId:string;instruction:string;occurrenceId:string}):Promise<{runId:string}>;
 kick(orgId:OrgId):void;
}
/** Adapter to peer-owned persistent in-app reminders. No email fallback or no-op success. */
export interface ScheduledRunNotifier {
 publish(input:{factId:string;orgId:OrgId;userId:string;scheduleId:string;code:'authorization_revoked'|'delivery_rejected'}):Promise<{durablyAccepted:true}>;
}
