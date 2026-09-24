import { PgWhiteboardCollaborationStore } from '../../src/infrastructure/whiteboard/pg-collaboration-store';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { toOrgId } from '../../src/domain/org-id';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import * as C from '@repo/contracts/whiteboard-workshop';
import { addOrgMember,asApp,ensureDatabase,migrateOnce,resetOrgs,seedOrg } from '../support/db';
process.env.KERNEL_ALLOW_TEST_PRINCIPAL='1';process.env.KERNEL_QUIET='1';
const org='wb-workshop-http',owner='wb-workshop-http-owner',viewer='wb-workshop-http-viewer';
let app:NestExpressApplication,base:string,boardId:string;
const call=(method:string,path:string,body?:unknown,user=owner)=>fetch(`${base}${path}`,{method,headers:{'content-type':'application/json','x-kernel-test-principal':`${user}:${org}`},...(body===undefined?{}:{body:JSON.stringify(body)})});
const path=(suffix:string)=>`/whiteboards/${boardId}/workshop/${suffix}`;
beforeAll(async()=>{ensureDatabase();await migrateOnce();await resetOrgs(org);await seedOrg({orgId:org,projectId:`${org}-project`});for(const user of [owner,viewer])await addOrgMember(org,user,'consultant',null);const{createApp}=await import('../../src/main');app=await createApp();await app.listen(0,'127.0.0.1');const address=app.getHttpServer().address();if(!address||typeof address==='string')throw new Error('No address');base=`http://127.0.0.1:${address.port}`;const created=await call('POST','/whiteboards',{requestId:randomUUID(),name:'Workshop HTTP'});expect(created.status).toBe(201);boardId=(await created.json() as {id:string}).id;const db=new PgDatabase(appConfig());try{await new PgWhiteboardCollaborationStore(db).writeCommands({orgId:toOrgId(org),userId:owner},boardId,{epoch:1,requestId:randomUUID(),commands:[{type:'create',object:{id:'note',schemaVersion:1,kind:'sticky',geometry:{x:0,y:0,width:100,height:100,rotation:0},text:'note',style:{},parentId:null,orderKey:''}}]});}finally{await db.close();}expect((await call('PUT',`/whiteboards/${boardId}/members`,{userId:viewer,role:'viewer'})).status).toBe(200);});
afterAll(async()=>{await app?.close();await resetOrgs(org);});
describe('workshop HTTP integration',()=>{
  it('enforces authentication and strict request fields',async()=>{
    expect((await fetch(`${base}${path('draft')}`)).status).toBe(401);
    expect((await call('PUT',path('draft'),{text:'private',userId:owner},viewer)).status).toBe(400);
    expect((await call('GET','/whiteboards/not-uuid/workshop/comments')).status).toBe(400);
  });
  it('does not let owner read viewer private draft and forbids viewer comments',async()=>{
    const saved=await call('PUT',path('draft'),{text:'secret'},viewer);expect(saved.status).toBe(200);expect(C.PrivateDraft.parse(await saved.json())).toMatchObject({text:'secret'});
    expect(C.PrivateDraft.parse(await(await call('GET',path('draft'))).json())).toMatchObject({text:''});
    expect((await call('POST',path('comments'),{requestId:randomUUID(),objectId:null,text:'x'},viewer)).status).toBe(404);
    const comment=await call('POST',path('comments'),{requestId:randomUUID(),objectId:null,text:'discussion'});expect(comment.status).toBe(201);C.Comment.parse(await comment.json());
    expect(C.CommentList.parse(await(await call('GET',path('comments'),undefined,viewer)).json()).items).toHaveLength(1);
  });
  it('maps quota conflicts to 409 and hides active totals from owner and viewer',async()=>{
    const created=await call('POST',path('votes'),{requestId:randomUUID(),title:'vote',quota:1,durationSeconds:60,objectIds:['note']});expect(created.status).toBe(201);const vote=C.Vote.parse(await created.json());
    const ballot=()=>call('POST',path(`votes/${vote.id}/ballots`),{requestId:randomUUID(),objectId:'note',count:1},viewer);
    const first=await ballot();expect(first.status).toBe(201);expect(C.Vote.parse(await first.json())).toMatchObject({used:1,closed:false,results:null});
    expect((await ballot()).status).toBe(409);
    for(const user of [owner,viewer]){
      const listed=C.VoteList.parse(await(await call('GET',path('votes'),undefined,user)).json());expect(listed.items[0]).toMatchObject({closed:false,results:null});expect(JSON.stringify(listed)).not.toContain(viewer);
    }
    const closedResponse=await call('POST',path(`votes/${vote.id}/close`));expect(closedResponse.status).toBe(201);
    expect(C.Vote.parse(await closedResponse.json())).toMatchObject({closed:true,results:[{objectId:'note',count:1}]});
    expect((await call('PUT',path('timer'),{durationSeconds:60},viewer)).status).toBe(404);
    const timer=await call('PUT',path('timer'),{durationSeconds:60});expect(timer.status).toBe(200);expect(C.Timer.parse(await timer.json()).running).toBe(true);
  });
  it('returns final totals after the server deadline without an explicit close',async()=>{
    const created=await call('POST',path('votes'),{requestId:randomUUID(),title:'deadline vote',quota:2,durationSeconds:60,objectIds:['note']});expect(created.status).toBe(201);const vote=C.Vote.parse(await created.json());
    const ballot=await call('POST',path(`votes/${vote.id}/ballots`),{requestId:randomUUID(),objectId:'note',count:1},viewer);expect(ballot.status).toBe(201);expect(C.Vote.parse(await ballot.json()).results).toBeNull();
    await asApp(org,s=>s.query("UPDATE whiteboard_votes SET deadline=clock_timestamp()-interval '1 second' WHERE org_id=$1 AND board_id=$2 AND id=$3",[org,boardId,vote.id]));
    for(const user of [owner,viewer]){
      const listed=C.VoteList.parse(await(await call('GET',path('votes'),undefined,user)).json());
      expect(listed.items.find(item=>item.id===vote.id)).toMatchObject({closed:true,results:[{objectId:'note',count:1}]});
    }
  });
  it('publishes a saved own draft and exposes only a post-commit receipt',async()=>{
    const savedResponse=await call('PUT',path('draft'),{text:'publish HTTP'});expect(savedResponse.status).toBe(200);
    const draft=C.PrivateDraft.parse(await savedResponse.json());expect(draft.revision).not.toBeNull();
    const input={requestId:randomUUID(),expectedRevision:draft.revision,geometry:{x:10,y:20,width:240,height:180,rotation:0}};
    const response=await call('POST',path('draft/publish'),input);expect(response.status).toBe(201);
    const receipt=C.PublishedDraft.parse(await response.json());expect(receipt.replayed).toBe(false);
    expect(C.PrivateDraft.parse(await(await call('GET',path('draft'))).json())).toEqual({text:'',revision:null});
    const retry=await call('POST',path('draft/publish'),input);expect(retry.status).toBe(201);expect(C.PublishedDraft.parse(await retry.json())).toEqual({...receipt,replayed:true});
    expect((await call('POST',path('draft/publish'),{...input,expectedRevision:randomUUID()})).status).toBe(409);
  });

});
