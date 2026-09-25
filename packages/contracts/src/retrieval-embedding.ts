import {z} from 'zod';
/**
 * Infrastructure-only protocol: no model/tool-selectable provider or credentials.
 *
 * `maxDimensions` = 2000 is pgvector's HNSW limit for the `vector` type. Every registered embedding
 * model gets an HNSW index (phase-18 F05, migration 20260924270000_kg_f05_hnsw_vector_index.sql), so a
 * wider model can be neither indexed nor registered. This constant is the one statement of that
 * fact; the SQL trigger repeats the number only because SQL cannot import it, and
 * `apps/api/tests/retrieval/kg-hnsw-permission-recall.test.ts` pins the two together.
 */
export const RETRIEVAL_EMBEDDING_LIMITS={maxArtifactBytes:4194304,maxSegments:256,maxTextBytes:32768,maxBatch:32,maxRequestBytes:1048576,maxResponseBytes:4194304,maxDimensions:2000,deadlineMs:30000} as const;
export const RetrievalEmbeddingRequest=z.object({texts:z.array(z.string().min(1)).min(1).max(RETRIEVAL_EMBEDDING_LIMITS.maxBatch)}).strict();
export const RetrievalEmbeddingResponse=z.object({model:z.string().min(1).max(256),modelVersion:z.string().min(1).max(256),vectors:z.array(z.array(z.number().finite()).min(1).max(RETRIEVAL_EMBEDDING_LIMITS.maxDimensions)).min(1).max(RETRIEVAL_EMBEDDING_LIMITS.maxBatch)}).strict();
