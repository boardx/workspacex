import type {DatabasePort} from '../../application/ports/database.port';
import type {ArtifactIndexWriter,ArtifactIndexSource,ArtifactIndexInput,ArtifactIndexBatch} from '../../application/retrieval/index-artifact-version';
/** An existing source recheck and all writes share the tenant transaction. */
export class PgArtifactIndexWriter implements ArtifactIndexWriter {
 constructor(private db:DatabasePort,private source:ArtifactIndexSource){}
 async write(input:ArtifactIndexInput,batch:ArtifactIndexBatch,embedding?:Parameters<ArtifactIndexWriter['write']>[2]):Promise<void>{
  await this.db.withTenant(input.orgId,async s=>{
   const current=await this.source.load(input);
   if(JSON.stringify(current)!==JSON.stringify(batch))throw new Error('artifact_index_changed');
   if(embedding){
    const registered=await s.query<{dims:number}>('SELECT dims FROM embedding_models WHERE model=$1 AND model_version=$2',[embedding.model,embedding.modelVersion]);
    if(registered.rows.length!==1||embedding.vectors.length!==batch.segments.length||embedding.vectors.some((v,i)=>v.segmentId!==batch.segments[i]?.segmentId||v.vector.length!==registered.rows[0]!.dims||v.vector.some(x=>!Number.isFinite(x))))throw new Error('artifact_embedding_model_unregistered');
   }
   for(const segment of batch.segments){
    const written=await s.query<{segment_id:string}>(`INSERT INTO segment_text(segment_id,org_id,artifact_id,artifact_version_id,project_id,source_type,layer,private,lifecycle,in_scope,occurred_at,confidential,content,tsv)
     SELECT sg.id,v.org_id,v.artifact_id,v.id,a.project_id,'file',CASE WHEN a.project_id IS NULL THEN 'org' ELSE 'project' END,false,CASE WHEN a.ingestion_status='READY' THEN 'effective' ELSE 'review-pending' END,true,v.pinned_at,false,$5,''::tsvector
     FROM segments sg JOIN artifact_versions v ON v.id=sg.artifact_version_id AND v.org_id=sg.org_id JOIN artifacts a ON a.id=v.artifact_id AND a.org_id=v.org_id
     WHERE v.org_id=$1 AND v.id=$2 AND v.content_hash=$3 AND sg.id=$4 AND a.source='upload' AND NOT a.confidential AND NOT a.synthesized AND a.ingestion_status IN ('SEGMENTED','ENRICHED','INDEXED','READY')
     ON CONFLICT(segment_id) DO UPDATE SET content=EXCLUDED.content,lifecycle=EXCLUDED.lifecycle,project_id=EXCLUDED.project_id,layer=EXCLUDED.layer
     RETURNING segment_id`,[input.orgId,input.artifactVersionId,batch.contentHash,segment.segmentId,segment.content]);
    if(written.rows.length!==1)throw new Error('artifact_index_changed');
    if(embedding){const vector=embedding.vectors.find(v=>v.segmentId===segment.segmentId)!;
     await s.query(`INSERT INTO segment_embeddings(segment_id,org_id,model,model_version,embedding) VALUES($1,$2,$3,$4,$5::vector) ON CONFLICT(segment_id,model,model_version) DO UPDATE SET embedding=EXCLUDED.embedding`,[segment.segmentId,input.orgId,embedding.model,embedding.modelVersion,JSON.stringify(vector.vector)]);
    }
   }
  });
 }
}
