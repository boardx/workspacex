import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import * as C from '@repo/contracts/whiteboard-proposal';
import { addOrgMember,ensureDatabase,migrateOnce,resetOrgs,seedOrg } from '../support/db';
import { addChatThread } from '../support/chat-db';
import { seedAgentRun } from '../support/agent-run-db';
process.env.KERNEL_ALLOW_TEST_PRINCIPAL='1';process.env.KERNEL_QUIET='1';
const org='wb-proposal-http',owner='wb-proposal-http-owner',viewer='wb-proposal-http-viewer';
const run='wb-proposal-http-run',oldInternalKey=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;
let app:NestExpressApplication,base:string,boardId:string;
const call=(method:string,path:string,body?:unknown,user=owner)=>fetch(`${base}${path}`,{method,headers:{'content-type':'application/json','x-kernel-test-principal':`${user}:${org}`},...(body===undefined?{}:{body:JSON.stringify(body)})});
const path=()=>`/whiteboards/${boardId}/proposals`;
function input():C.CreateProposal{return{requestId:randomUUID(),title:'Suggestion',baseEpoch:1,baseSeq:0,commands:[{type:'create',object:{id:`proposal_${randomUUID()}`,schemaVersion:1,kind:'sticky',geometry:{x:0,y:0,width:100,height:100,rotation:0},text:'API proposal',style:{},parentId:null,orderKey:''}}]};}
beforeAll(async()=>{ensureDatabase();await migrateOnce();await resetOrgs(org);await seedOrg({orgId:org,projectId:`${org}-project`});for(const user of [owner,viewer])await addOrgMember(org,user,'consultant',null);await addChatThread({orgId:org,id:`${run}-thread`,projectId:null,visibilityScope:'private',createdBy:owner});await seedAgentRun({orgId:org,id:run,threadId:`${run}-thread`,authorId:owner});process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY='proposal-test-key';const{createApp}=await import('../../src/main');app=await createApp();await app.listen(0,'127.0.0.1');const address=app.getHttpServer().address();if(!address||typeof address==='string')throw new Error('No address');base=`http://127.0.0.1:${address.port}`;const created=await call('POST','/whiteboards',{requestId:randomUUID(),name:'Proposal HTTP'});expect(created.status).toBe(201);boardId=(await created.json() as {id:string}).id;expect((await call('PUT',`/whiteboards/${boardId}/members`,{userId:viewer,role:'viewer'})).status).toBe(200);});
afterAll(async()=>{await app?.close();await resetOrgs(org);if(oldInternalKey===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=oldInternalKey;});
describe('AI proposal REST trust boundaries',()=>{
  it('requires authentication, rejects actor spoofing, and denies viewers writes',async()=>{
    expect((await fetch(`${base}${path()}`)).status).toBe(401);
    expect((await call('POST',path(),{...input(),actorId:'admin'})).status).toBe(400);
    expect((await call('POST',path(),{...input(),generatorLabel:'pretend AI'})).status).toBe(400);
    expect((await call('POST',path(),input(),viewer)).status).toBe(404);
  });
  it('returns explicit pending/rejected states and bound principal provenance',async()=>{
    const response=await call('POST',path(),input());expect(response.status).toBe(201);
    const proposal=C.Proposal.parse(await response.json());expect(proposal).toMatchObject({status:'pending',provenance:{submittedBy:owner,participant:{kind:'human-api',actorId:owner,verified:true}}});
    const listed=await call('GET',path(),undefined,viewer);expect(listed.status).toBe(200);expect(C.ProposalList.parse(await listed.json()).items).toContainEqual(proposal);
    expect((await call('POST',`${path()}/${proposal.id}/accept`,{requestId:randomUUID()},viewer)).status).toBe(404);
    const rejected=await call('POST',`${path()}/${proposal.id}/reject`,{requestId:randomUUID()});expect(rejected.status).toBe(201);expect(C.Proposal.parse(await rejected.json())).toMatchObject({status:'rejected',decidedBy:owner,committedSeq:null});
  });
  it('derives verified AI provenance only from an authenticated durable run',async()=>{
    const endpoint=`${base}/internal/agent-runs/${run}/whiteboards/${boardId}/proposals`,body={...input(),orgId:org};
    expect((await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).status).toBe(401);
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':'proposal-test-key'},body:JSON.stringify(body)});
    expect(response.status,await response.clone().text()).toBe(201);
    expect(C.Proposal.parse(await response.json())).toMatchObject({provenance:{submittedBy:owner,actor:{kind:'human',id:owner},source:{kind:'agent-run',ref:run},participant:{kind:'agent',verified:true,agentId:'agent-test',agentName:'agent-test',agentVersionId:'agent-version-test',runId:run,provider:'test-provider',model:'test-model',modelVersion:'test-model'}}});
  });
  it('enforces ACL and idempotency on one atomic multi-proposal decision',async()=>{
    const first=C.Proposal.parse(await (await call('POST',path(),input())).json()),second=C.Proposal.parse(await (await call('POST',path(),input())).json());
    const requestId=randomUUID(),decision={requestId,action:'reject' as const,selections:[{proposalId:first.id,commandIndexes:[0]},{proposalId:second.id,commandIndexes:[0]}]};
    expect((await call('POST',`${path()}/decisions`,decision,viewer)).status).toBe(404);
    const response=await call('POST',`${path()}/decisions`,decision);expect(response.status).toBe(201);
    const result=C.BatchDecisionResult.parse(await response.json());expect(result.proposals.map(item=>item.status)).toEqual(['rejected','rejected']);
    expect(C.BatchDecisionResult.parse(await (await call('POST',`${path()}/decisions`,decision)).json())).toEqual(result);
    expect((await call('POST',`${path()}/decisions`,{...decision,action:'accept'})).status).toBe(409);
  });
});
