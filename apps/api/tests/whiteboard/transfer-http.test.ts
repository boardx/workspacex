import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { whiteboardTransfer as T } from '@repo/contracts';
import { WHITEBOARD_COLLABORATION_STORE, type WhiteboardCollaborationStore } from '../../src/application/whiteboard/collaboration-ports';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';
import { toOrgId } from '../../src/domain/org-id';

process.env.KERNEL_ALLOW_TEST_PRINCIPAL='1';process.env.KERNEL_QUIET='1';
const ORG='wb-transfer-3978-a',OTHER='wb-transfer-3978-b',OWNER='wb-transfer-owner',VIEWER='wb-transfer-viewer',OUTSIDER='wb-transfer-outsider';
let app:NestExpressApplication,base:string,store:WhiteboardCollaborationStore;
const headers=(userId=OWNER,orgId=ORG)=>({'content-type':'application/json','x-kernel-test-principal':`${userId}:${orgId}`});
const call=(method:string,path:string,body?:unknown,userId=OWNER,orgId=ORG)=>fetch(`${base}/whiteboards${path}`,{method,headers:headers(userId,orgId),...(body===undefined?{}:{body:JSON.stringify(body)})});
const geometry={x:1,y:2,width:200,height:100,rotation:0};
const sourceObjects=[
  {id:'frame',schemaVersion:1 as const,kind:'frame' as const,geometry,text:'Frame',style:{},parentId:null,orderKey:'a'},
  {id:'note',schemaVersion:1 as const,kind:'sticky' as const,geometry,text:'Portable',style:{fill:'#fff'},parentId:'frame',orderKey:'b',extensionData:{origin:'plugin'}},
  {id:'line',schemaVersion:1 as const,kind:'connector' as const,geometry,text:'',style:{},parentId:null,orderKey:'c',connector:{from:'frame',to:'note'}},
];
async function createBoard(name='Transfer source'){const response=await call('POST','',{requestId:randomUUID(),name});expect(response.status).toBe(201);return response.json() as Promise<{id:string}>;}

beforeAll(async()=>{ensureDatabase();await migrateOnce();await resetOrgs(ORG,OTHER);await seedOrg({orgId:ORG,projectId:`${ORG}-project`});await seedOrg({orgId:OTHER,projectId:`${OTHER}-project`});for(const user of [OWNER,VIEWER])await addOrgMember(ORG,user,'consultant',null);await addOrgMember(OTHER,OUTSIDER,'consultant',null);const module=await import('../../src/main');app=await module.createApp();store=app.get(WHITEBOARD_COLLABORATION_STORE);await app.listen(0,'127.0.0.1');const address=app.getHttpServer().address();if(!address||typeof address==='string')throw new Error('missing address');base=`http://127.0.0.1:${address.port}`;});
afterAll(async()=>{await app?.close();await resetOrgs(ORG,OTHER);});

describe('portable board HTTP transfer',()=>{
  it('roundtrips frame, connector and extension data while remapping every identity',async()=>{
    const source=await createBoard();await store.writeCommands({orgId:toOrgId(ORG),userId:OWNER},source.id,{epoch:1,requestId:randomUUID(),commands:sourceObjects.map(object=>({type:'create' as const,object}))});
    const exported=await call('GET',`/${source.id}/export`);expect(exported.status).toBe(200);const firstBytes=await exported.text();
    const secondBytes=await (await call('GET',`/${source.id}/export`)).text();expect(secondBytes).toBe(firstBytes);
    const bundle=T.PortableBoardPackage.parse(JSON.parse(firstBytes));expect(bundle.objects).toEqual([...sourceObjects].sort((a,b)=>a.id.localeCompare(b.id)));
    expect(firstBytes).toBe(T.serializePortableBoardPackage(bundle));expect(firstBytes).not.toContain('exportedAt');
    const request={requestId:randomUUID(),package:bundle};const preview=await call('POST','/imports/preview',request);expect(preview.status).toBe(201);expect(T.ImportBoardPreview.parse(await preview.json())).toMatchObject({objectCount:3,identitiesRemapped:3,contentLosses:[]});
    const imported=await call('POST','/imports',request);expect(imported.status).toBe(201);const result=T.ImportBoardResult.parse(await imported.json());expect(result.board.id).not.toBe(source.id);expect(result.replayed).toBe(false);
    const state=await store.load({orgId:toOrgId(ORG),userId:OWNER},result.board.id);const exportedCopy=T.PortableBoardPackage.parse(await (await call('GET',`/${result.board.id}/export`)).json());
    expect(state.seq).toBe(1);expect(exportedCopy.objects.map(o=>o.id)).not.toEqual(sourceObjects.map(o=>o.id));
    const frame=exportedCopy.objects.find(o=>o.kind==='frame')!,note=exportedCopy.objects.find(o=>o.kind==='sticky')!,line=exportedCopy.objects.find(o=>o.kind==='connector')!;
    expect(note.parentId).toBe(frame.id);expect(line.connector).toEqual({from:frame.id,to:note.id});expect(note.extensionData).toEqual({origin:'plugin'});
    const replay=T.ImportBoardResult.parse(await (await call('POST','/imports',request)).json());expect(replay).toMatchObject({board:{id:result.board.id},replayed:true});
  });
  it('validates the complete package before writing and rejects requestId payload conflicts',async()=>{
    const source=await createBoard(),bundle=T.PortableBoardPackage.parse(await (await call('GET',`/${source.id}/export`)).json()),requestId=randomUUID();
    const before=await asApp(ORG,c=>c.query<{count:string}>(`SELECT count(*)::text count FROM whiteboards WHERE org_id=$1`,[ORG]));
    const invalid={requestId,package:{...bundle,objects:[{...sourceObjects[1],parentId:'missing'}],manifest:{...bundle.manifest,objectCount:1}}};const response=await call('POST','/imports',invalid);expect(response.status).toBe(400);expect(JSON.stringify(await response.json())).not.toContain('missing');
    const after=await asApp(ORG,c=>c.query<{count:string}>(`SELECT count(*)::text count FROM whiteboards WHERE org_id=$1`,[ORG]));expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    const valid={requestId,package:bundle};expect((await call('POST','/imports',valid)).status).toBe(201);expect((await call('POST','/imports',{...valid,name:'different'})).status).toBe(409);
  });
  it('keeps export tenant-scoped, honors viewer read and revocation, and audits transfers',async()=>{
    const source=await createBoard();expect((await call('GET',`/${source.id}/export`,undefined,OUTSIDER,OTHER)).status).toBe(404);
    expect((await call('PUT',`/${source.id}/members`,{userId:VIEWER,role:'viewer'})).status).toBe(200);expect((await call('GET',`/${source.id}/export`,undefined,VIEWER)).status).toBe(200);
    expect((await call('DELETE',`/${source.id}/members/${VIEWER}`)).status).toBe(200);expect((await call('GET',`/${source.id}/export`,undefined,VIEWER)).status).toBe(404);
    const audit=await asApp(ORG,c=>c.query<{action:string}>(`SELECT action FROM whiteboard_transfer_audit WHERE org_id=$1 AND board_id=$2`,[ORG,source.id]));expect(audit.rows.map(row=>row.action)).toContain('export');
  });
});
