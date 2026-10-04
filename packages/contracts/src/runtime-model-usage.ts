import {z} from "zod";
const Count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Ownership=z.object({orgId:z.string().min(1).max(200),attemptId:z.string().min(1).max(300),leaseEpoch:z.number().int().positive(),requestId:z.string().uuid()});
export const RuntimeModelRequestStart=Ownership.extend({startedAt:z.string().datetime({offset:true}),modelId:z.string().min(1).max(200),callPurpose:z.enum(["primary","history-summary","script-retry","retrieval-embedding","retrieval-rerank"]).default("primary")}).strict();
export const RuntimeModelRequestTerminal=Ownership.extend({endedAt:z.string().datetime({offset:true}),outcome:z.enum(["succeeded","failed"]),
 usage:z.object({total:Count.optional(),prompt:Count.optional(),completion:Count.optional(),cacheInput:Count.optional(),reasoningOutput:Count.optional()}).strict()}).strict();

/** Transient exact request body for private admission only; never persist/log its content. */
const ChatRuntimeModelRequestAdmission=RuntimeModelRequestStart.extend({
 logicalCallId:z.string().min(1).max(500),serializedBody:z.string().min(1).max(2_000_000),
 outputTokenLimit:z.number().int().positive().max(2147483647),
}).strict();

/** Actual embedding HTTP request; no chat cap/rate is asserted for an input-only model. */
export const InputOnlyRuntimeModelRequestAdmission=RuntimeModelRequestStart.extend({
 callPurpose:z.literal("retrieval-embedding"),billingMode:z.literal("input-only"),
 logicalCallId:z.string().min(1).max(500),serializedBody:z.string().min(1).max(2_000_000),
 requestPath:z.string().min(1).max(500).refine(value=>value.startsWith('/')&&!/[?#]/.test(value)),
}).strict();
export const RuntimeModelRequestAdmission=z.union([ChatRuntimeModelRequestAdmission,InputOnlyRuntimeModelRequestAdmission]);
