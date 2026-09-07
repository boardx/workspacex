import {randomUUID} from 'node:crypto';
import type {DatabasePort} from '../../application/ports/database.port';
import type {ObjectStore} from '../../application/artifact/ports';
import type {EmbeddingPort} from '../../application/retrieval/ports';
import {IndexArtifactVersion} from '../../application/retrieval/index-artifact-version';
import {PgArtifactRepository} from '../artifact/pg-artifact-repository';
import {PgIdentityRepository} from '../identity/pg-identity-repository';
import {PgArtifactIndexSource} from './pg-artifact-index-source';
import {PgArtifactIndexWriter} from './pg-artifact-index-writer';
export function createArtifactIndexProducer(db:DatabasePort,objects:ObjectStore,embeddings?:EmbeddingPort):IndexArtifactVersion{
 const source=new PgArtifactIndexSource(db,new PgArtifactRepository(db),objects,{repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()}});
 return new IndexArtifactVersion(source,new PgArtifactIndexWriter(db,source),embeddings);
}
