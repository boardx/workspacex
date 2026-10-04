import {z} from 'zod';
const Ownership=z.object({orgId:z.string().min(1).max(200),requestId:z.string().uuid()});
const Count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const ArtifactEmbeddingRequestStart=Ownership.extend({startedAt:z.string().datetime({offset:true}),modelId:z.string().min(1).max(200)}).strict();
export const ArtifactEmbeddingRequestTerminal=Ownership.extend({endedAt:z.string().datetime({offset:true}),outcome:z.enum(['succeeded','failed']),usage:z.object({total:Count.optional(),prompt:Count.optional(),completion:Count.optional(),cacheInput:Count.optional(),reasoningOutput:Count.optional()}).strict()}).strict();

export const ArtifactEmbeddingRequestAdmission=ArtifactEmbeddingRequestStart.extend({
 billingMode:z.literal('input-only'),logicalCallId:z.string().min(1).max(500),serializedBody:z.string().min(1).max(2_000_000),
 requestPath:z.string().min(1).max(500).refine(value=>value.startsWith('/')&&!/[?#]/.test(value)),
}).strict();
