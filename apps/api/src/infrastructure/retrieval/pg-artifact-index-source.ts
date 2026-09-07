import {hasPii} from '../../domain/files/pii-detect';
import {isLocalOrg} from '../../domain/identity/local-org';
import {computeContentHash,versionContentHash} from '../../domain/artifact/content-hash';
import {RETRIEVAL_EMBEDDING_LIMITS as L} from '@repo/contracts/retrieval-embedding';
import type {DatabasePort} from '../../application/ports/database.port';
import type {ArtifactRepository,ObjectStore} from '../../application/artifact/ports';
import type {AuthorizeDeps} from '../../application/identity/authorize';
import {disclose,guard} from '../../application/security/permission-filter';
import type {ArtifactIndexInput,ArtifactIndexSource,ArtifactIndexBatch} from '../../application/retrieval/index-artifact-version';
import {runExtractionAdapter} from '../../domain/files/extraction-adapters';
interface Source {project_id:string|null;source:string;confidential:boolean;synthesized:boolean;ingestion_status:string;}
/** Indexing runs as the actual version publisher, never a caller-selected principal. */
export class PgArtifactIndexSource implements ArtifactIndexSource {
 constructor(private db:DatabasePort,private artifacts:ArtifactRepository,private objects:ObjectStore,private identity:AuthorizeDeps){}
 async load(input:ArtifactIndexInput):Promise<ArtifactIndexBatch>{
  const organization=await this.identity.repo.findOrganization(input.orgId);
  if(!organization)throw new Error('artifact_index_unavailable');
  const version=await this.artifacts.findVersion(input.orgId,input.artifactVersionId);
  if(!version)throw new Error('artifact_index_unavailable');
  const source=await this.db.withTenant(input.orgId,async s=>(await s.query<Source>('SELECT project_id,source,confidential,synthesized,ingestion_status FROM artifacts WHERE org_id=$1 AND id=$2',[input.orgId,version.artifactId])).rows[0]);
  if(!source||source.source!=='upload'||source.confidential||source.synthesized||!['SEGMENTED','ENRICHED','INDEXED','READY'].includes(source.ingestion_status))throw new Error('artifact_index_unavailable');
  const guarded=guard({kind:'artifact',id:version.artifactId},source);
  const permission={orgId:input.orgId,userId:version.pinnedBy,projectId:source.project_id??undefined,action:'read.allHands',path:'retrieval' as const};
  if((await disclose(this.identity,{...permission,items:[guarded]})).visible.length!==1)throw new Error('artifact_index_unavailable');
  const head=await this.objects.head(version.objectStorageKey);
  if(!head||head.sizeBytes!==version.sizeBytes||head.sizeBytes>L.maxArtifactBytes)throw new Error('artifact_index_unavailable');
  const bytes=await this.objects.get(version.objectStorageKey);
  if(!bytes||bytes.length!==version.sizeBytes||versionContentHash([computeContentHash(bytes)])!==version.contentHash)throw new Error('artifact_index_unavailable');
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('artifact_index_unsupported_format');}
  // The legacy extractor's binary modalities are stubs. Only actual UTF-8 textual input
  // may use its deterministic text/CSV/JSONL units in this producer.
  if(text.trimStart().startsWith('%PDF-')||[...text].some(c=>{const n=c.charCodeAt(0);return n<32&&!['\t','\n','\r','\f'].includes(c);}))throw new Error('artifact_index_unsupported_format');
  const extraction=runExtractionAdapter(bytes);
  if(!['pdf-office','csv-jsonl'].includes(extraction.adapter)||extraction.units.length>L.maxSegments)throw new Error('artifact_index_unsupported_format');
  if(source.ingestion_status==='READY'&&hasPii(extraction.derivedText))throw new Error('artifact_review_required');
  const disclosed=await disclose(this.identity,{...permission,items:await this.artifacts.findSegments(input.orgId,input.artifactVersionId)});
  const segments=disclosed.visible.map(x=>x.payload).sort((a,b)=>a.ordinal-b.ordinal);
  if(segments.length!==extraction.units.length)throw new Error('artifact_index_unavailable');
  const mapped=segments.map((segment,ordinal)=>{
   const unit=extraction.units[ordinal]!;
   if(segment.ordinal!==ordinal||segment.kind!==unit.segmentKind||!segment.anchors.some(a=>a.kind===unit.anchorKind&&a.locator===unit.locator)||!unit.text.trim()||Buffer.byteLength(unit.text)>L.maxTextBytes)throw new Error('artifact_index_unavailable');
   return {segmentId:segment.id,content:unit.text};
  });
  return {artifactVersionId:version.id,artifactId:version.artifactId,contentHash:version.contentHash,projectId:source.project_id,externalEmbeddingAllowed:!isLocalOrg(organization.kind),requiresReview:hasPii(extraction.derivedText),segments:mapped};
 }
}
