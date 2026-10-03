import { z } from "zod";
const Timestamp=z.string().datetime({offset:true});
const Count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Tokens=z.string().regex(/^\d+$/);
const Zone=z.string().max(100).refine(value=>{try{new Intl.DateTimeFormat("en",{timeZone:value});return true;}catch{return false;}},"Invalid IANA timezone");
export const Query=z.object({start:Timestamp,end:Timestamp,timezone:Zone,asOf:Timestamp.optional(),
 modelProvider:z.string().max(200).optional(),modelId:z.string().max(200).optional(),userId:z.string().max(200).optional(),
 projectId:z.string().max(200).optional(),unassignedProject:z.enum(["true","false"]).optional(),
 runId:z.string().max(200).optional(),threadId:z.string().max(200).optional(),agentId:z.string().max(200).optional(),
 cursorTime:Timestamp.optional(),cursorId:z.string().max(200).optional(),limit:z.coerce.number().int().min(1).max(100).default(25),
}).strict().refine(q=>Date.parse(q.end)>Date.parse(q.start)&&Date.parse(q.end)-Date.parse(q.start)<=366*86_400_000,"Window must be positive and at most 366 days")
 .refine(q=>Boolean(q.cursorTime)===Boolean(q.cursorId),"Both cursor fields are required")
 .refine(q=>!(q.projectId&&q.unassignedProject==="true"),"Project filters conflict");
export const Totals=z.object({inputTokens:Tokens,outputTokens:Tokens,totalTokens:Tokens,callCount:Count,failedCalls:Count,
 reportedCalls:Count,legacyCalls:Count,unknownCalls:Count,unknownInputCalls:Count,unknownOutputCalls:Count}).strict();
export const Summary=z.object({asOf:Timestamp,start:Timestamp,end:Timestamp,timezone:Zone,coverage:z.literal("partial"),
 current:Totals,previous:Totals,
 dispatchIntents:Count,unsettledDispatchIntents:Count,
 truncated:z.object({members:z.boolean(),models:z.boolean(),matrix:z.boolean(),projects:z.boolean()}).strict(),
 trend:z.array(z.object({day:z.string(),totalTokens:Tokens,callCount:Count}).strict()),
 members:z.array(z.object({userId:z.string(),totalTokens:Tokens,callCount:Count}).strict()),
 models:z.array(z.object({modelProvider:z.string(),modelId:z.string(),totalTokens:Tokens,callCount:Count}).strict()),
 matrix:z.array(z.object({userId:z.string(),modelProvider:z.string(),modelId:z.string(),totalTokens:Tokens,callCount:Count}).strict()),
 projects:z.array(z.object({projectId:z.string().nullable(),totalTokens:Tokens,callCount:Count}).strict()),
}).strict();
export const Call=z.object({id:z.string(),userId:z.string(),runId:z.string().nullable(),projectId:z.string().nullable(),
 threadId:z.string().nullable(),agentId:z.string().nullable(),modelProvider:z.string(),modelId:z.string(),
 occurredAt:Timestamp,startedAt:Timestamp.nullable(),endedAt:Timestamp.nullable(),executionAttemptId:z.string().nullable(),
 totalTokens:Tokens,inputTokens:Tokens.nullable(),outputTokens:Tokens.nullable(),
 cacheInputTokens:Tokens.nullable().default(null),reasoningOutputTokens:Tokens.nullable().default(null),
 totalSource:z.enum(["reported","unknown","legacy"]),outcome:z.enum(["succeeded","failed"]),callPurpose:z.string().nullable(),
 costMicros:Tokens.nullable(),currency:z.string().nullable(),priceVersion:z.string().nullable(),
}).strict();
export const Calls=z.object({asOf:Timestamp,coverage:z.literal("partial"),calls:z.array(Call),
 nextCursor:z.object({occurredAt:Timestamp,id:z.string()}).strict().nullable()}).strict();
export const operations={
 summary:{method:"GET",path:"/organizations/:orgId/ai-usage",in:Query,out:Summary,err:["FORBIDDEN","NO_ORG_MEMBERSHIP"]},
 calls:{method:"GET",path:"/organizations/:orgId/ai-usage/calls",in:Query,out:Calls,err:["FORBIDDEN","NO_ORG_MEMBERSHIP"]},
 platformSummary:{method:"GET",path:"/platform/organizations/:orgId/ai-usage",in:Query,out:Summary,err:["NOT_PLATFORM_SUPERUSER","ORGANIZATION_NOT_FOUND"]},
 platformCalls:{method:"GET",path:"/platform/organizations/:orgId/ai-usage/calls",in:Query,out:Calls,err:["NOT_PLATFORM_SUPERUSER","ORGANIZATION_NOT_FOUND"]},
} as const;
