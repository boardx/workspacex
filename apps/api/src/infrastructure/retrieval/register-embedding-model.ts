import {Client} from 'pg';
import type {PgConfig} from '../db/pg-config';
import {RETRIEVAL_EMBEDDING_LIMITS as L} from '@repo/contracts/retrieval-embedding';
/** Deployment identity only; existing runtime SELECT-only model registry stays unchanged. */
export async function registerEmbeddingModel(config:PgConfig,model:string,modelVersion:string,dims:number):Promise<void>{
 if(!model||!modelVersion||model.length>256||modelVersion.length>256||!Number.isSafeInteger(dims)||dims<1||dims>L.maxDimensions)throw new Error('embedding_model_configuration_invalid');
 const client=new Client(config);await client.connect();
 try{
  await client.query('BEGIN');
  await client.query('INSERT INTO embedding_models(model,model_version,dims) VALUES($1,$2,$3) ON CONFLICT(model,model_version) DO NOTHING',[model,modelVersion,dims]);
  const current=await client.query<{dims:number}>('SELECT dims FROM embedding_models WHERE model=$1 AND model_version=$2',[model,modelVersion]);
  if(current.rows[0]?.dims!==dims)throw new Error('embedding_model_revision_conflict');
  await client.query('COMMIT');
 }catch{await client.query('ROLLBACK');throw new Error('embedding_model_registration_failed');}finally{await client.end();}
}
