import {z} from 'zod';
const Count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const AuxiliaryModelStart=z.object({orgId:z.string().min(1).max(200),requestId:z.string().uuid(),startedAt:z.string().datetime({offset:true}),modelId:z.string().min(1).max(200)}).strict();
export const AuxiliaryModelAdmission=AuxiliaryModelStart.extend({logicalCallId:z.string().min(1).max(500),serializedBody:z.string().min(1).max(2_000_000),outputTokenLimit:z.number().int().positive().max(2147483647)}).strict();
export const AuxiliaryModelTerminal=z.object({orgId:z.string().min(1).max(200),requestId:z.string().uuid(),endedAt:z.string().datetime({offset:true}),outcome:z.enum(['succeeded','failed']),usage:z.object({total:Count.optional(),prompt:Count.optional(),completion:Count.optional(),cacheInput:Count.optional(),reasoningOutput:Count.optional()}).strict()}).strict();
