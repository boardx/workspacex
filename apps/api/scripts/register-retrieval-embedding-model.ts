import {migrationConfig} from '../src/infrastructure/db/pg-config';
import {registerEmbeddingModel} from '../src/infrastructure/retrieval/register-embedding-model';
void registerEmbeddingModel(migrationConfig(),process.env.KERNEL_EMBEDDING_MODEL_ID??'',process.env.KERNEL_EMBEDDING_MODEL_VERSION??'',Number(process.env.KERNEL_EMBEDDING_DIMENSIONS)).catch(()=>{console.error('Embedding model registration failed');process.exitCode=1;});
