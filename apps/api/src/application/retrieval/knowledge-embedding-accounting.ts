/** Shared receipt shape, distinct durable knowledge provenance and private route. */
export type {ArtifactEmbeddingUsagePort as KnowledgeEmbeddingUsagePort} from './artifact-embedding-accounting';
export const KNOWLEDGE_EMBEDDING_USAGE=Symbol('KnowledgeEmbeddingUsage');
export class KnowledgeEmbeddingOwnershipDenied extends Error {constructor(){super('knowledge_accounting_ownership_denied');this.name='KnowledgeEmbeddingOwnershipDenied';}}
