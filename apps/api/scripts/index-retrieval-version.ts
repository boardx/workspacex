import {appConfig} from '../src/infrastructure/db/pg-config';
import {PgDatabase} from '../src/infrastructure/db/pg-database';
import {FsObjectStore} from '../src/infrastructure/storage/fs-object-store';
import {objectStoreRoot} from '../src/infrastructure/storage/object-store-root';
import {createArtifactIndexProducer} from '../src/infrastructure/retrieval/artifact-index-producer';
import {langChainEmbeddingClientFromEnv} from '../src/infrastructure/retrieval/langchain-embedding-client';
import {toOrgId} from '../src/domain/org-id';
/** Trusted deployment maintenance entry; no server secret or model key accepted in arguments. */
async function main(){
 const orgId=process.env.RETRIEVAL_INDEX_ORG_ID,artifactVersionId=process.env.RETRIEVAL_INDEX_VERSION_ID;
 if(!orgId||!artifactVersionId)throw new Error('index_target_required');
 const db=new PgDatabase(appConfig());
 try{await createArtifactIndexProducer(db,new FsObjectStore(objectStoreRoot()),langChainEmbeddingClientFromEnv()??undefined).index({orgId:toOrgId(orgId),artifactVersionId});}
 finally{await db.close();}
}
void main().catch(()=>{console.error('Artifact indexing failed');process.exitCode=1;});
