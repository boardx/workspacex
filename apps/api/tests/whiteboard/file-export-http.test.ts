import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { addOrgMember,ensureDatabase,migrateOnce,resetOrgs,seedOrg } from '../support/db';

process.env.KERNEL_ALLOW_TEST_PRINCIPAL='1';process.env.KERNEL_QUIET='1';
const ORG='wb-file-http-4052-a',OTHER='wb-file-http-4052-b',OWNER='wb-file-http-owner',VIEWER='wb-file-http-viewer',OUTSIDER='wb-file-http-outsider';
let app:NestExpressApplication,base:string,boardId:string;
const headers=(userId=OWNER,orgId=ORG)=>({'content-type':'application/json','x-kernel-test-principal':`${userId}:${orgId}`});
const call=(method:string,path:string,body?:unknown,userId=OWNER,orgId=ORG)=>fetch(`${base}${path}`,{method,headers:headers(userId,orgId),...(body===undefined?{}:{body:JSON.stringify(body)})});

beforeAll(async()=>{ensureDatabase();await migrateOnce();await resetOrgs(ORG,OTHER);await seedOrg({orgId:ORG,projectId:`${ORG}-project`});await seedOrg({orgId:OTHER,projectId:`${OTHER}-project`});for(const user of [OWNER,VIEWER])await addOrgMember(ORG,user,'consultant',null);await addOrgMember(OTHER,OUTSIDER,'consultant',null);const module=await import('../../src/main');app=await module.createApp();await app.listen(0,'127.0.0.1');const address=app.getHttpServer().address();if(!address||typeof address==='string')throw new Error('missing address');base=`http://127.0.0.1:${address.port}`;const created=await call('POST','/whiteboards',{requestId:randomUUID(),name:'File export HTTP'});expect(created.status).toBe(201);boardId=(await created.json() as {id:string}).id;});
afterAll(async()=>{await app?.close();await resetOrgs(ORG,OTHER);});

describe('Board file export authenticated HTTP boundary',()=>{
  it('requires authentication and hides cross-tenant boards',async()=>{
    const unauthenticated=await fetch(`${base}/whiteboards/${boardId}/file-exports`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({format:'svg',background:'#ffffff'})});expect(unauthenticated.status).toBe(401);
    expect((await call('POST',`/whiteboards/${boardId}/file-exports`,{format:'svg',background:'#ffffff'},OUTSIDER,OTHER)).status).toBe(404);
  });
  it('binds status/cancel/content to the authenticated actor and current membership',async()=>{
    expect((await call('PUT',`/whiteboards/${boardId}/members`,{userId:VIEWER,role:'viewer'})).status).toBe(200);
    const created=await call('POST',`/whiteboards/${boardId}/file-exports`,{format:'sticky-csv',background:'#ffffff'},VIEWER);expect(created.status).toBe(201);const job=await created.json() as {jobId:string};
    expect((await call('GET',`/whiteboard-file-exports/${job.jobId}`,undefined,OWNER)).status).toBe(404);
    expect((await call('DELETE',`/whiteboards/${boardId}/members/${VIEWER}`)).status).toBe(200);
    expect((await call('GET',`/whiteboard-file-exports/${job.jobId}`,undefined,VIEWER)).status).toBe(404);
    expect((await call('GET',`/whiteboard-file-exports/${job.jobId}/content`,undefined,VIEWER)).status).toBe(404);
  });
});
