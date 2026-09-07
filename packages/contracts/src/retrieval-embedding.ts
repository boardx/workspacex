import {z} from 'zod';
/** Infrastructure-only protocol: no model/tool-selectable provider or credentials. */
export const RETRIEVAL_EMBEDDING_LIMITS={maxArtifactBytes:4194304,maxSegments:256,maxTextBytes:32768,maxBatch:32,maxRequestBytes:1048576,maxResponseBytes:4194304,maxDimensions:8192,deadlineMs:30000} as const;
export const RetrievalEmbeddingRequest=z.object({texts:z.array(z.string().min(1)).min(1).max(RETRIEVAL_EMBEDDING_LIMITS.maxBatch)}).strict();
export const RetrievalEmbeddingResponse=z.object({model:z.string().min(1).max(256),modelVersion:z.string().min(1).max(256),vectors:z.array(z.array(z.number().finite()).min(1).max(RETRIEVAL_EMBEDDING_LIMITS.maxDimensions)).min(1).max(RETRIEVAL_EMBEDDING_LIMITS.maxBatch)}).strict();
