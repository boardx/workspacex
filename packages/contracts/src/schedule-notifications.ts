import {z} from 'zod';
import {ScheduleItem,SCHEDULE_LIMITS} from './standard-schedule';

/** Failure facts are owned by standard_schedules, not copied into a second inbox. */
export const ScheduleNotification=z.object({
 factId:z.string().uuid(),
 scheduleId:z.string().uuid(),
 code:ScheduleItem.shape.failureCode.unwrap(),
 acceptedAt:z.string().datetime(),
 readAt:z.string().datetime().nullable(),
}).strict();
export const ScheduleNotificationListInput=z.object({cursor:z.string().uuid().optional()}).strict();
export const ScheduleNotificationListOutput=z.object({
 notifications:z.array(ScheduleNotification).max(SCHEDULE_LIMITS.pageSize),
 cursor:z.string().uuid().optional(),
}).strict();
export const ScheduleNotificationReadInput=z.object({factId:z.string().uuid()}).strict();
export const ScheduleNotificationReadOutput=z.object({read:z.literal(true)}).strict();
