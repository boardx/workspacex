import {z} from "zod";
const Count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Ownership=z.object({orgId:z.string().min(1).max(200),attemptId:z.string().min(1).max(300),leaseEpoch:z.number().int().positive(),requestId:z.string().uuid()});
export const RuntimeModelRequestStart=Ownership.extend({startedAt:z.string().datetime({offset:true}),modelId:z.string().min(1).max(200),callPurpose:z.enum(["primary","history-summary","script-retry"]).default("primary")}).strict();
export const RuntimeModelRequestTerminal=Ownership.extend({endedAt:z.string().datetime({offset:true}),outcome:z.enum(["succeeded","failed"]),
 usage:z.object({total:Count.optional(),prompt:Count.optional(),completion:Count.optional(),cacheInput:Count.optional(),reasoningOutput:Count.optional()}).strict()}).strict();
