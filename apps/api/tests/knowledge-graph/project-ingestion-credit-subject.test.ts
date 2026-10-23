import {beforeAll,afterAll,it,expect} from 'vitest';
import {ensureDatabase,migrateOnce,seedOrg,asApp} from '../support/db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {PgKgProjectIngestion} from '../../src/infrastructure/knowledge-graph/pg-kg-project-ingestion';
import {toOrgId} from '../../src/domain/org-id';
import type {DatabasePort} from '../../src/application/ports/database.port';
const org=toOrgId('kg-project-credit-subject'),project='kg-project-credit-project',user='kg-project-credit-user',db=new PgDatabase(appConfig());
beforeAll(async()=>{ensureDatabase();await migrateOnce();await seedOrg({orgId:org,projectId:project});
 await asApp(org,async s=>{await s.query("INSERT INTO org_memberships(org_id,user_id,org_role) VALUES($1,$2,'admin')",[org,user]);await s.query('INSERT INTO project_creation_requests(fingerprint,org_id,actor_id,project_id) VALUES($1,$2,$3,$4)',['credit-subject-fingerprint',org,user,project]);});
});
afterAll(async()=>db.close());
// Supply a queued project; attribution is read from the real tenant database, not queue/caller data.
const queueDb={withTenant:db.withTenant.bind(db),withoutTenant:async()=>({rows:[{org_id:org,project_id:project}],rowCount:1})} as unknown as DatabasePort;
it('uses immutable project creator only while that actor is an actual organization member',async()=>{
 const repo=new PgKgProjectIngestion(queueDb);expect(await repo.pendingProjects()).toEqual([{orgId:org,projectId:project,billingSubject:{orgId:org,userId:user}}]);
 await asApp(org,s=>s.query('DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2',[org,user]));
 expect(await repo.pendingProjects()).toEqual([{orgId:org,projectId:project}]);
});
