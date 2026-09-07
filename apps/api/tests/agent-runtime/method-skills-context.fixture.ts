import {StandardContextService} from '../../src/application/agent-run/standard-context-tools';
import {StandardContextSource} from '../../src/infrastructure/agent-run/standard-context-source';
import {PgProjectListRepository} from '../../src/infrastructure/project/pg-project-list-repository';
import {PgProjectOverviewRepository} from '../../src/infrastructure/project/pg-project-overview-repository';
import {PgBindingRepository} from '../../src/infrastructure/artifact/pg-binding-repository';
import {PgArtifactRepository} from '../../src/infrastructure/artifact/pg-artifact-repository';
import {PgProvenanceRepository} from '../../src/infrastructure/provenance/pg-provenance-repository';
import {PgFileRetrieval} from '../../src/infrastructure/agent-run/pg-file-retrieval';
import type {PgDatabase} from '../../src/infrastructure/db/pg-database';
import type {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import type {PgChatRepository} from '../../src/infrastructure/chat/pg-chat-repository';
import type {ObjectStore} from '../../src/application/artifact/ports';
import {randomUUID} from 'node:crypto';
export function realMethodContext(db:PgDatabase,identity:PgIdentityRepository,chat:PgChatRepository,objects:ObjectStore){
 const ids={next:()=>randomUUID()},auth={repo:identity,ids};
 return new StandardContextService({repo:new PgProjectListRepository(db),identity},
  {repo:new PgProjectOverviewRepository(db),auth,binding:{bindings:new PgBindingRepository(db),artifacts:new PgArtifactRepository(db),auth,ids,provenance:new PgProvenanceRepository(db)}},
  new StandardContextSource(new PgFileRetrieval(db),objects,{...auth,chat}));
}
