import {z} from 'zod';
export const RETRIEVAL_RERANK_LIMITS={maxCandidates:100,maxTextBytes:32768,maxRequestBytes:1048576,maxResponseBytes:1048576,deadlineMs:30000} as const;
export const RetrievalRerankRequest=z.object({query:z.string().min(1).max(2000),candidates:z.array(z.object({id:z.string().min(1).max(256),content:z.string().min(1)}).strict()).max(RETRIEVAL_RERANK_LIMITS.maxCandidates)}).strict();
export const RetrievalRerankResponse=z.object({model:z.string().min(1).max(256),modelVersion:z.string().min(1).max(256),ids:z.array(z.string().min(1).max(256)).max(RETRIEVAL_RERANK_LIMITS.maxCandidates)}).strict();
