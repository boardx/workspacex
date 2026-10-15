import { PgInterviewScopeRepository } from '../../src/infrastructure/interview/pg-interview-scope-repository';
import {createCustomExpert,listCustomExperts} from '../../src/application/interview/custom-expert-library';
import { randomUUID } from 'node:crypto';
import { beforeAll,afterAll,it,expect } from 'vitest';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgCustomExpertLibrary } from '../../src/infrastructure/interview/pg-custom-expert-library';
import { toOrgId } from '../../src/domain/org-id';
import { ensureDatabase,migrateOnce,seedOrg,resetOrgs,addOrgMember,addCredential,asOwner } from '../support/db';
const org=toOrgId('org-custom-expert-5661'),other=toOrgId('org-custom-expert-other-5661');
const fields={name:'同名专家',role:'采购决策顾问',domains:'采购',focus:'决策链验证',style:'审慎反证',bio:'从预算与角色分工分析采购决策。',limits:'仅模拟画像，不能作为真人证据。'};
let db:PgDatabase,repo:PgCustomExpertLibrary;
const deps=()=>({repo,scope:new PgInterviewScopeRepository(db),decisions:{next:()=>randomUUID()}});
const create=(actor:Parameters<PgCustomExpertLibrary['create']>[0],input:Parameters<PgCustomExpertLibrary['create']>[1])=>createCustomExpert(deps(),actor,input);
const list=async(actor:Parameters<PgCustomExpertLibrary['list']>[0])=>(await listCustomExperts(deps(),actor)).items;
beforeAll(async()=>{ensureDatabase();await migrateOnce();await resetOrgs(org,other);await seedOrg({orgId:org,projectId:'proj-custom-5661'});await seedOrg({orgId:other,projectId:'proj-custom-other-5661'});await addCredential(`${org}-owner`,`${org}-owner@example.test`,'owner');await addOrgMember(org,`${org}-owner`,'consultant',null);await addOrgMember(other,`${other}-owner`,'consultant',null);await addOrgMember(org,'custom-other-actor','consultant',null);db=new PgDatabase(appConfig());repo=new PgCustomExpertLibrary(db);},120000);
afterAll(async()=>{await resetOrgs(org,other);await db?.close();await asOwner(s=>s.query('DELETE FROM credentials WHERE user_id=$1',[`${org}-owner`]));});
it('persists owner profiles, retries idempotently, and isolates other actors and tenants',async()=>{
 const actor={orgId:org,actorId:`${org}-owner`},requestId=randomUUID();
 const created=await create(actor,{fields,requestId});
 expect(created.expertId).toMatch(/^custom-expert-/u);
 expect(await create(actor,{fields,requestId})).toEqual(created);
 expect(await list(actor)).toContainEqual(created);
 expect(await list({orgId:org,actorId:'custom-other-actor'})).toEqual([]);
 expect(await list({orgId:other,actorId:`${other}-owner`})).toEqual([]);
 await expect(create(actor,{fields:{...fields,bio:'不同内容'},requestId})).rejects.toThrow();
 const duplicate=await create(actor,{fields,requestId:randomUUID()});
 expect(duplicate.expertId).not.toBe(created.expertId);
 expect((await list(actor)).filter(item=>item.fields.name===fields.name)).toHaveLength(2);
});
it('rejects writes from a nonmember without persisting a profile',async()=>{
 await expect(create({orgId:org,actorId:`${other}-owner`},{fields,requestId:randomUUID()})).rejects.toThrow();
 await expect(list({orgId:org,actorId:`${other}-owner`})).rejects.toThrow();
});
it('fails closed if a repository returns a guarded profile owned by another actor',async()=>{
 const actor={orgId:org,actorId:`${org}-owner`};const stored=await repo.create(actor,{fields,requestId:randomUUID()});
 await expect(listCustomExperts({...deps(),repo:{list:async()=>[{...stored,actorId:'custom-other-actor'}],create:(a,i)=>repo.create(a,i)}},actor)).rejects.toThrow();
});
it('stores and reloads every optional profile fact in real JSONB without changing legacy profiles',async()=>{
 const actor={orgId:org,actorId:`${org}-owner`};
 const profile={category:'技术',location:'深圳',age:42,occupation:'研究员',goals:['理解需求','验证假设'],interests:['设计'],painPoints:['资料不足'],motivations:['改进体验'],influences:['同行'],personalityTraits:{introvertExtrovert:3,analyticalCreative:7,busyTimeRich:5},serviceValue:'检验假设',typicalAdvice:'先验证问题'};
 const input={fields:{...fields,profile},requestId:randomUUID()};const created=await create(actor,input);
 expect(created.fields.profile).toEqual(profile);expect((await list(actor)).find(item=>item.expertId===created.expertId)?.fields).toEqual(input.fields);
 expect(await create(actor,input)).toEqual(created);
 expect((await list(actor)).some(item=>item.fields.profile===undefined)).toBe(true);
 expect(await list({orgId:org,actorId:'custom-other-actor'})).toEqual([]);
});
