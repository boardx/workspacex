import type {z} from 'zod';
import type {ScheduleNotificationListInput,ScheduleNotificationListOutput,ScheduleNotificationReadInput,ScheduleNotificationReadOutput} from '@repo/contracts/schedule-notifications';
import type {OrgId} from '../../domain/org-id';
export const SCHEDULE_NOTIFICATIONS=Symbol('ScheduleNotifications');
export interface ScheduleNotificationViewer {readonly orgId:OrgId;readonly userId:string;}
export interface ScheduleNotifications {
 list(viewer:ScheduleNotificationViewer,input:z.infer<typeof ScheduleNotificationListInput>):Promise<z.infer<typeof ScheduleNotificationListOutput>>;
 markRead(viewer:ScheduleNotificationViewer,input:z.infer<typeof ScheduleNotificationReadInput>):Promise<z.infer<typeof ScheduleNotificationReadOutput>>;
}
export class ScheduleNotificationForbiddenError extends Error {}
export class ScheduleNotificationNotFoundError extends Error {}
