import type {z} from 'zod';
import type {ArtifactEmbeddingRequestStart,ArtifactEmbeddingRequestTerminal} from '@repo/contracts/artifact-embedding-accounting';
import type {OrgId} from '../../domain/org-id';
export interface ArtifactEmbeddingUsagePort {
 start(orgId:OrgId,operationId:string,input:Omit<z.infer<typeof ArtifactEmbeddingRequestStart>,'orgId'>):Promise<void>;
 terminal(orgId:OrgId,operationId:string,input:Omit<z.infer<typeof ArtifactEmbeddingRequestTerminal>,'orgId'>):Promise<void>;
}
export const ARTIFACT_EMBEDDING_USAGE=Symbol('ArtifactEmbeddingUsage');

export class ArtifactEmbeddingOwnershipDenied extends Error {
 constructor(){super('artifact_accounting_ownership_denied');this.name='ArtifactEmbeddingOwnershipDenied';}
}
