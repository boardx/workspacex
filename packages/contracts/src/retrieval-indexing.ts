import {z} from 'zod';
export const ArtifactIndexVersionId=z.string().min(1).max(256);
export const ArtifactIndexingRequest=z.object({}).strict();
export const ArtifactIndexingResult=z.object({artifactVersionId:z.string(),status:z.enum(['ready','review_pending','busy','failed'])}).strict();
