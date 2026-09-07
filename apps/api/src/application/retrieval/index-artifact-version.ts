import type {OrgId} from '../../domain/org-id';
import type {EmbeddingPort} from './ports';
/** Trusted ingestion input. The producer resolves bytes and segment identities itself. */
export interface ArtifactIndexInput {readonly orgId:OrgId;readonly artifactVersionId:string;}
export interface ArtifactIndexSegment {readonly segmentId:string;readonly content:string;}
export interface ArtifactIndexBatch {
 readonly artifactVersionId:string;
 readonly artifactId:string;
 readonly contentHash:string;
 readonly projectId:string|null;
 readonly externalEmbeddingAllowed:boolean;
 readonly requiresReview:boolean;
 readonly segments:readonly ArtifactIndexSegment[];
}
export interface ArtifactIndexSource {
 /** Must reject unsupported extraction, missing bytes, withdrawn sources and hash mismatch. */
 load(input:ArtifactIndexInput):Promise<ArtifactIndexBatch>;
}
export interface ArtifactIndexWriter {
 /** Recheck immutable origin/current eligibility; atomically write all segments or none. */
 write(input:ArtifactIndexInput,batch:ArtifactIndexBatch,embedding?:{
  readonly model:string;readonly modelVersion:string;
  readonly vectors:readonly {readonly segmentId:string;readonly vector:readonly number[]}[];
 }):Promise<void>;
}
export interface ArtifactIndexProducer {index(input:ArtifactIndexInput):Promise<void>;}
/** Model choice is constructor-only and shared for document and query vectors. */
export class IndexArtifactVersion implements ArtifactIndexProducer {
 constructor(private source:ArtifactIndexSource,private writer:ArtifactIndexWriter,private embeddings?:EmbeddingPort){}
 async index(input:ArtifactIndexInput):Promise<void>{
  const batch=await this.source.load(input);
  if(batch.artifactVersionId!==input.artifactVersionId||batch.segments.length===0)throw new Error('artifact_index_unavailable');
  if(new Set(batch.segments.map(s=>s.segmentId)).size!==batch.segments.length)throw new Error('artifact_index_unavailable');
  if(!this.embeddings||batch.requiresReview){await this.writer.write(input,batch);return;}
  if(!batch.externalEmbeddingAllowed)throw new Error('artifact_embedding_egress_denied');
  const vectors=[];
  let dimensions:number|undefined;
  for(const segment of batch.segments){
   const vector=await this.embeddings.embed(segment.content);
   if(vector.length===0||vector.some(v=>!Number.isFinite(v))||(dimensions!==undefined&&dimensions!==vector.length))throw new Error('artifact_embedding_unavailable');
   dimensions=vector.length;vectors.push({segmentId:segment.segmentId,vector});
  }
  await this.writer.write(input,batch,{model:this.embeddings.model,modelVersion:this.embeddings.modelVersion,vectors});
 }
}

export const ARTIFACT_INDEX_PRODUCER=Symbol('ArtifactIndexProducer');
