import {migrationConfig} from '../src/infrastructure/db/pg-config';
import {registerEmbeddingModel} from '../src/infrastructure/retrieval/register-embedding-model';
// Rejections are fixed `embedding_model_*` codes (never driver text or credentials), so printing one tells the operator why without leaking anything.
void registerEmbeddingModel(migrationConfig(),process.env.KERNEL_EMBEDDING_MODEL_ID??'',process.env.KERNEL_EMBEDDING_MODEL_VERSION??'',Number(process.env.KERNEL_EMBEDDING_DIMENSIONS)).catch((e:unknown)=>{console.error(`Embedding model registration failed: ${e instanceof Error&&/^embedding_model_[a-z_]+$/.test(e.message)?e.message:'unknown'}`);process.exitCode=1;});
