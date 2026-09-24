import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import * as C from '@repo/contracts/whiteboard-proposal';
import { addOrgMember,ensureDatabase,migrateOnce,resetOrgs,seedOrg } from '../support/db';
process.env.KERNEL_ALLOW_TEST_PRINCIPAL='1';process.env.KERNEL_QUIET='1';
const org='wb-proposal-http',owner='wb-proposal-http-owner',viewer='wb-proposal-http-viewer';
let app:NestExpressApplication,base:string,boardId:string;
const call=(method:string,path:string,body?:unknown,user=owner)=>fetch(`${base}${path}`,{method,headers:{'content-type':'application/json','x-kernel-test-principal':`${user}:${org}`},...(body===undefined?{}:{body:JSON.stringify(body)})});
const path=()=>`/whiteboards/${boardId}/proposals`;
function input():C.CreateProposal{return{requestId:randomUUID(),title:'Suggestion',baseEpoch:1,baseSeq:0,commands:[{type:'create',object:{id:`proposal_${randomUUID()}`,schemaVersion:1,kind:'sticky',geometry:{x:0,y:0,width:100,height:100,rotation:0},text:'API proposal',style:{},parentId:null,orderKey:''}}]};}
beforeAll(async()=>{ensureDatabase();await migrateOnce();await resetOrgs(org);await seedOrg({orgId:org,projectId:`${org}-project`});for(const user of [owner,viewer])await addOrgMember(org,user,'consultant',null);const{createApp}=await import('../../src/main');app=await createApp();await app.listen(0,'127.0.0.1');const address=app.getHttpServer().address();if(!address||typeof address==='string')throw new Error('No address');base=`http://127.0.0.1:${address.port}`;const created=await call('POST','/whiteboards',{requestId:randomUUID(),name:'Proposal HTTP'});expect(created.status).toBe(201);boardId=(await created.json() as {id:string}).id;expect((await call('PUT',`/whiteboards/${boardId}/members`,{userId:viewer,role:'viewer'})).status).toBe(200);});
afterAll(async()=>{await app?.close();await resetOrgs(org);});
describe('AI proposal REST trust boundaries',()=>{
  it('requires authentication, rejects actor spoofing, and denies viewers writes',async()=>{
    expect((await fetch(`${base}${path()}`)).status).toBe(401);
    expect((await call('POST',path(),{...input(),actorId:'admin'})).status).toBe(400);
    expect((await call('POST',path(),input(),viewer)).status).toBe(404);
  });
  it('returns explicit pending/rejected states and bound principal provenance',async()=>{
    const response=await call('POST',path(),{...input(),generatorLabel:'declared AI'});expect(response.status).toBe(201);
    const proposal=C.Proposal.parse(await response.json());expect(proposal).toMatchObject({status:'pending',provenance:{submittedBy:owner,generator:{label:'declared AI',verified:false}}});
    const listed=await call('GET',path(),undefined,viewer);expect(listed.status).toBe(200);expect(C.ProposalList.parse(await listed.json()).items).toContainEqual(proposal);
    expect((await call('POST',`${path()}/${proposal.id}/accept`,{requestId:randomUUID()},viewer)).status).toBe(404);
    const rejected=await call('POST',`${path()}/${proposal.id}/reject`,{requestId:randomUUID()});expect(rejected.status).toBe(201);expect(C.Proposal.parse(await rejected.json())).toMatchObject({status:'rejected',decidedBy:owner,committedSeq:null});
  });
});
