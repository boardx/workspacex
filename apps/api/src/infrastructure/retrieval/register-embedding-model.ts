import {Client} from 'pg';
import type {PgConfig} from '../db/pg-config';
import {RETRIEVAL_EMBEDDING_LIMITS as L} from '@repo/contracts/retrieval-embedding';
/**
 * Deployment identity only; existing runtime SELECT-only model registry stays unchanged.
 *
 * Every registered model gets an HNSW index (phase-18 F05), and HNSW on `vector` stops at
 * `L.maxDimensions`. A wider model is refused with its own code instead of the generic
 * registration failure, so the operator learns WHY -- both before the database is touched and,
 * should the limits ever drift, when the database's trigger refuses it (SQLSTATE 22023).
 */
export async function registerEmbeddingModel(config:PgConfig,model:string,modelVersion:string,dims:number):Promise<void>{
 if(!model||!modelVersion||model.length>256||modelVersion.length>256||!Number.isSafeInteger(dims)||dims<1)throw new Error('embedding_model_configuration_invalid');
 if(dims>L.maxDimensions)throw new Error('embedding_model_dimensions_exceed_index_limit');
 const client=new Client(config);await client.connect();
 try{
  await client.query('BEGIN');
  await client.query('INSERT INTO embedding_models(model,model_version,dims) VALUES($1,$2,$3) ON CONFLICT(model,model_version) DO NOTHING',[model,modelVersion,dims]);
  const current=await client.query<{dims:number}>('SELECT dims FROM embedding_models WHERE model=$1 AND model_version=$2',[model,modelVersion]);
  if(current.rows[0]?.dims!==dims)throw new Error('embedding_model_revision_conflict');
  await client.query('COMMIT');
 }catch(e){
  await client.query('ROLLBACK');
  if((e as {code?:unknown}).code==='22023')throw new Error('embedding_model_dimensions_exceed_index_limit');
  throw new Error('embedding_model_registration_failed');
 }finally{await client.end();}
}
