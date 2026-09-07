import {StructuralArtifactReviewGate} from './structural-artifact-review-gate';
import {randomUUID} from 'node:crypto';
import type {DatabasePort} from '../../application/ports/database.port';
import type {ObjectStore} from '../../application/artifact/ports';
import type {ArtifactIndexProducer} from '../../application/retrieval/index-artifact-version';
import {ArtifactIndexingService} from '../../application/retrieval/request-artifact-index';
import type {ReviewGate} from '../../application/files/ingestion-worker';
import {PgArtifactRepository} from '../artifact/pg-artifact-repository';
import {PgIdentityRepository} from '../identity/pg-identity-repository';
import {PgIngestionRepository} from '../files/pg-ingestion-repository';
import {PgArtifactIndexTargets} from './pg-artifact-index-targets';
export function createArtifactIndexingService(db:DatabasePort,objects:ObjectStore,producer:ArtifactIndexProducer,review?:ReviewGate):ArtifactIndexingService{
 const ids={next:()=>randomUUID()},artifacts=new PgArtifactRepository(db),identity={repo:new PgIdentityRepository(db),ids},targets=new PgArtifactIndexTargets(db);
 const gate=review??new StructuralArtifactReviewGate(artifacts,objects,targets,identity);
 return new ArtifactIndexingService(targets,identity,
  {outbox:new PgIngestionRepository(db),artifacts,store:objects,ids,indexer:producer},producer,gate);
}
