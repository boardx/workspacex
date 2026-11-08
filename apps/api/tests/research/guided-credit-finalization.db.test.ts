import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { research as C } from '@repo/contracts';
import { PgGuidedRuntimeStore } from '../../src/infrastructure/research/pg-guided-runtime-store';
import { GuidedRuntimeService, initialRuntime } from '../../src/application/research/guided-runtime-service';
import { CreditConsumptionError } from '../../src/application/billing/credit-consumption';
import type { DatabasePort } from '../../src/application/ports/database.port';
import { toOrgId } from '../../src/domain/org-id';
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';
import { resetCredentials, seedCredential } from '../support/auth';
const org=toOrgId('org-research-credit-6429');
const actor={orgId:org,userId:`${org}-owner`,sessionId:'research-credit-6429'};
const session=C.GuidedResearchSession.parse({sessionId:actor.sessionId,title:'Credit lease test',brief:{topic:'Grid',goal:'Entry',region:'EU',focus:'Policy',timeRange:'2026'},stage:'brief',resumeStage:'brief',status:'active',progress:0,sourceCount:0,reportId:null,createdAt:'now',updatedAt:'now'});
const command={sessionId:actor.sessionId,node:'brief' as const,action:'prepare_plan' as const,requestId:'credit-once',expectedVersion:0};
const db:DatabasePort={withTenant:(orgId,work)=>asApp(orgId,c=>work({query:async(sql,params=[])=>({rows:(await c.query(sql,[...params])).rows})})),withoutTenant:async()=>{throw new Error('tenant required');},close:async()=>{}};
const store=new PgGuidedRuntimeStore(db);
async function row(){return (await asApp(org,c=>c.query('SELECT state,requests,active_request_id FROM guided_research_runtime WHERE org_id=$1 AND session_id=$2',[org,actor.sessionId]))).rows[0]!;}
beforeAll(async()=>{await ensureDatabase();await migrateOnce();},180000);
beforeEach(async()=>{
 await resetOrgs(org);await resetCredentials([actor.userId],[]);
 await seedCredential({userId:actor.userId,email:'research-credit-6429@example.test',password:'isolated-test-password',emailVerified:true});
 await seedOrg({orgId:org,projectId:'research-credit-project'});
 await asApp(org,c=>c.query(`INSERT INTO guided_research_sessions(id,org_id,owner_user_id,idempotency_key,title,brief,stage,resume_stage) VALUES($1,$2,$3,'seed',$4,$5::jsonb,'brief','brief')`,[actor.sessionId,org,actor.userId,session.title,JSON.stringify(session.brief)]));
});
afterAll(async()=>{await resetOrgs(org);await resetCredentials([actor.userId],[]);});
it.each(['credit_required','credit_accounting_unavailable'] as const)('actual PostgreSQL finalizes %s and a restarted runtime replays without dispatch',async code=>{
 const refusal=new CreditConsumptionError(code,'user',actor.userId);
 const model={complete:vi.fn(async()=>{throw refusal;})};
 const service=new GuidedRuntimeService(store,model,{search:vi.fn()},{provider:'test',id:'test'});
 await expect(service.execute(actor,session,command)).rejects.toBe(refusal);
 const persisted=await row();
 expect(persisted.state).toMatchObject({busy:false,leaseUntil:null,errorCode:code.toUpperCase(),version:1});
 expect(persisted.requests['credit-once'].done).toBe(true);
 const restarted=new GuidedRuntimeService(new PgGuidedRuntimeStore(db),model,{search:vi.fn()},{provider:'test',id:'test'});
 const refreshed=await restarted.get(actor,session);
 expect(refreshed.creditFailure?.ownerId).toBe(code==='credit_required'?actor.userId:undefined);
 expect(await restarted.execute(actor,session,command)).toEqual(refreshed);
 expect(model.complete).toHaveBeenCalledTimes(1);
});
it.each(['request','version'] as const)('stale %s cannot release a newer live lease or mark its command done',async fence=>{
 await store.read(actor,initialRuntime(session));
 const old=await store.claim(actor,command,'old-hash');
 // Simulate an expired worker being replaced under the real persisted owner/epoch.
 await asApp(org,c=>c.query(`UPDATE guided_research_runtime SET active_request_id=$3, state=jsonb_set(state,'{version}',$4::jsonb), requests=requests || '{"new-request":{"hash":"new-hash","done":false}}'::jsonb WHERE org_id=$1 AND session_id=$2`,[org,actor.sessionId,fence==='request'?'new-request':command.requestId,JSON.stringify(fence==='version'?old.state.version+1:old.state.version)]));
 const before=await row();
 await expect(store.write(actor,command.requestId,{...old.state,busy:false,leaseUntil:null,errorCode:'CREDIT_REQUIRED'},true)).rejects.toMatchObject({reasonCode:'RESEARCH_GRAPH_VERSION_CONFLICT'});
 expect(await row()).toEqual(before);
 expect(before.state.busy).toBe(true);expect(before.requests['credit-once'].done).toBe(false);
});
