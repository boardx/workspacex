import {z} from 'zod';
export const SCHEDULE_LIMITS={maxInstructionChars:8000,maxSummaryChars:200,maxResponseBytes:65536,maxActivePerUser:20,pageSize:50,maxFutureDays:366} as const;
export const ScheduleToolName=z.enum(['wx_schedule_create','wx_schedule_list','wx_schedule_cancel']);
const id=z.string().min(1).max(256);
const timezone=z.string().min(1).max(128).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'invalid IANA timezone');
const base={instruction:z.string().trim().min(1).max(SCHEDULE_LIMITS.maxInstructionChars),timezone,idempotencyKey:z.string().uuid()};
// Root object schema is compatible with model function parameter schemas. The
// trusted API validates the trigger/spec relationship after JSON Schema parsing.
export const ScheduleCreateInput=z.object({...base,trigger:z.enum(['once','cron']),scheduleSpec:z.object({
 at:z.string().datetime({offset:true}).optional(),
 expression:z.string().min(9).max(128).refine(value=>value.trim().split(/\s+/).length===5,'five-field cron required').optional(),
}).strict()}).strict().superRefine((input,ctx)=>{
 const once=input.trigger==='once';
 if(once?(!input.scheduleSpec.at||input.scheduleSpec.expression!==undefined):(!input.scheduleSpec.expression||input.scheduleSpec.at!==undefined))ctx.addIssue({code:z.ZodIssueCode.custom,message:'scheduleSpec must match trigger'});
});
export const ScheduleListInput=z.object({cursor:z.string().uuid().optional()}).strict();
export const ScheduleCancelInput=z.object({scheduleId:z.string().uuid(),expectedRevision:z.number().int().positive().optional()}).strict();
export const ScheduleStatus=z.enum(['active','cancelled','completed','failed']);
export const ScheduleItem=z.object({scheduleId:z.string().uuid(),summary:z.string().max(SCHEDULE_LIMITS.maxSummaryChars),nextRunAt:z.string().datetime().nullable(),status:ScheduleStatus,revision:z.number().int().positive(),failureCode:z.enum(['authorization_revoked','delivery_rejected']).nullable()}).strict();
export const ScheduleCreateOutput=ScheduleItem;
export const ScheduleListOutput=z.object({schedules:z.array(ScheduleItem).max(SCHEDULE_LIMITS.pageSize),cursor:z.string().uuid().optional()}).strict();
export const ScheduleCancelOutput=z.object({cancelled:z.boolean()}).strict();
export const ScheduleToolRequest=z.object({orgId:id,userId:id,attemptId:id,leaseEpoch:z.number().int().positive(),toolCallId:id,permissionRequestId:z.string().uuid().optional(),toolName:ScheduleToolName,toolArgs:z.record(z.unknown())}).strict();
export const SCHEDULE_TOOL_SCHEMAS={wx_schedule_create:ScheduleCreateInput,wx_schedule_list:ScheduleListInput,wx_schedule_cancel:ScheduleCancelInput} as const;
export const SCHEDULE_OUTPUT_SCHEMAS={wx_schedule_create:ScheduleCreateOutput,wx_schedule_list:ScheduleListOutput,wx_schedule_cancel:ScheduleCancelOutput} as const;

/** Internal official scheduler payload; contains only trusted resource identities. */
export const ScheduleWake = z.object({orgId:z.string().min(1).max(256),scheduleId:z.string().uuid()}).strict();
