import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { whiteboardHistory as H } from '@repo/contracts';
import { WHITEBOARD_COLLABORATION_STORE, type WhiteboardCollaborationStore } from '../../src/application/whiteboard/collaboration-ports';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';
import { toOrgId } from '../../src/domain/org-id';

process.env.KERNEL_ALLOW_TEST_PRINCIPAL='1';process.env.KERNEL_QUIET='1';process.env.WORKSPACEX_BOARD_BLOB_PROVIDER='filesystem';process.env.WORKSPACEX_BOARD_SINGLE_REPLICA='true';
process.env.WORKSPACEX_BOARD_CONTENT_KEYS=JSON.stringify({1:Buffer.alloc(32,47).toString('base64')});
const ORG='wb-history-3973-a',OTHER='wb-history-3973-b',CLEANUP='wb-history-3973-cleanup',OWNER='wb-history-owner',EDITOR='wb-history-editor',OUTSIDER='wb-history-outsider';
let app:NestExpressApplication,base:string,store:WhiteboardCollaborationStore,blobRoot:string;
const headers=(userId=OWNER,orgId=ORG)=>({'content-type':'application/json','x-kernel-test-principal':`${userId}:${orgId}`});
const call=(method:string,path:string,body?:unknown,userId=OWNER,orgId=ORG)=>fetch(`${base}/whiteboards${path}`,{method,headers:headers(userId,orgId),...(body===undefined?{}:{body:JSON.stringify(body)})});
const geometry={x:1,y:2,width:200,height:100,rotation:0};
const object={id:'note',schemaVersion:1 as const,kind:'sticky' as const,geometry,text:'Durable checkpoint',style:{fill:'#fff'},parentId:null,orderKey:'a'};
async function start(){const module=await import('../../src/main');app=await module.createApp();store=app.get(WHITEBOARD_COLLABORATION_STORE);await app.listen(0,'127.0.0.1');const address=app.getHttpServer().address();if(!address||typeof address==='string')throw new Error('missing address');base=`http://127.0.0.1:${address.port}`;}
async function createBoard(){const response=await call('POST','',{requestId:randomUUID(),name:'History source'});expect(response.status).toBe(201);return response.json() as Promise<{id:string}>;}

beforeAll(async()=>{ensureDatabase();blobRoot=await mkdtemp(join(tmpdir(),'wsx-board-history-'));process.env.WORKSPACEX_BOARD_BLOB_ROOT=blobRoot;await migrateOnce();await resetOrgs(ORG,OTHER,CLEANUP);await seedOrg({orgId:ORG,projectId:`${ORG}-project`});await seedOrg({orgId:OTHER,projectId:`${OTHER}-project`});await seedOrg({orgId:CLEANUP,projectId:`${CLEANUP}-project`});for(const user of [OWNER,EDITOR])await addOrgMember(ORG,user,'consultant',null);await addOrgMember(OTHER,OUTSIDER,'consultant',null);await addOrgMember(CLEANUP,OWNER,'consultant',null);await start();});
afterAll(async()=>{await app?.close();await resetOrgs(ORG,OTHER,CLEANUP);if(blobRoot)await rm(blobRoot,{recursive:true,force:true});});

describe('whiteboard history HTTP and PostgreSQL boundary',()=>{
  it('survives app/store reconstruction with the same digest and no PG content bytes',async()=>{
    const rich={...object,id:'rich',text:`${'长'.repeat(600)}尾部`,extensionData:{mermaid:{source:'graph TD; A-->B'},image:{assetId:'asset-1'},drawing:{points:[[0,0],[1,1]]}}};
    const board=await createBoard();await store.writeCommands({orgId:toOrgId(ORG),userId:OWNER},board.id,{epoch:1,requestId:randomUUID(),commands:[{type:'create',object},{type:'create',object:rich}]});
    const head=H.HistoryHead.parse(await (await call('GET',`/${board.id}/checkpoints/head`)).json()),requestId=randomUUID();
    const input={requestId,label:'Workshop close',reason:'Facilitator approved',retentionDays:365,expectedHead:head};
    const created=H.Checkpoint.parse(await (await call('POST',`/${board.id}/checkpoints`,input)).json());expect(created.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    const row=await asApp(ORG,c=>c.query<{blob_key:string;content_sha256:string;size_bytes:string}>(`SELECT blob_key,content_sha256,size_bytes::text FROM whiteboard_checkpoints WHERE org_id=$1 AND board_id=$2 AND checkpoint_id=$3`,[ORG,board.id,created.id]));expect(row.rows[0]).toMatchObject({content_sha256:created.contentDigest,size_bytes:String(created.byteLength)});
    await app.close();await start();
    const preview=H.CheckpointPreview.parse(await (await call('GET',`/${board.id}/checkpoints/${created.id}`)).json());expect(preview.checkpoint.contentDigest).toBe(created.contentDigest);expect(preview.objects.find(value=>value.object.id==='note')).toMatchObject({object:expect.objectContaining({text:'Durable checkpoint'}),deleted:false});expect(preview.objects.find(value=>value.object.id==='rich')?.object).toMatchObject({text:rich.text,extensionData:rich.extensionData});
    const replay=H.Checkpoint.parse(await (await call('POST',`/${board.id}/checkpoints`,input)).json());expect(replay.id).toBe(created.id);
  });
  it('compares current/versions and restores an isolated new Board atomically',async()=>{
    const board=await createBoard();await store.writeCommands({orgId:toOrgId(ORG),userId:OWNER},board.id,{epoch:1,requestId:randomUUID(),commands:[{type:'create',object}]});
    const head=H.HistoryHead.parse(await (await call('GET',`/${board.id}/checkpoints/head`)).json());
    const checkpoint=H.Checkpoint.parse(await (await call('POST',`/${board.id}/checkpoints`,{requestId:randomUUID(),label:'Before edit',reason:'Recovery point',retentionDays:365,expectedHead:head})).json());
    await store.writeCommands({orgId:toOrgId(ORG),userId:OWNER},board.id,{epoch:1,requestId:randomUUID(),commands:[{type:'text',id:'note',index:0,deleteCount:7,insert:'Changed'}]});
    const sourceBefore=await store.head({orgId:toOrgId(ORG),userId:OWNER},board.id);
    const comparison=H.CheckpointComparison.parse(await (await call('POST',`/${board.id}/checkpoints/compare`,{fromCheckpointId:checkpoint.id,to:'current'})).json());expect(comparison).toMatchObject({added:0,modified:1,deleted:0});
    const restoreRequest={requestId:randomUUID(),sourceContentDigest:checkpoint.contentDigest,boardName:'Recovered workshop',reason:'Facilitator recovery',retentionDays:365};
    const receipt=H.RestoreReceipt.parse(await (await call('POST',`/${board.id}/checkpoints/${checkpoint.id}/restores`,restoreRequest)).json());expect(receipt.restoredBoardId).not.toBe(board.id);
    expect(await store.head({orgId:toOrgId(ORG),userId:OWNER},board.id)).toEqual(sourceBefore);
    const restored=await store.load({orgId:toOrgId(ORG),userId:OWNER},receipt.restoredBoardId);expect(restored).toMatchObject({epoch:1,seq:0});
    const restoredPreview=H.CheckpointPreview.parse(await (await call('GET',`/${receipt.restoredBoardId}/checkpoints/${receipt.restoredCheckpointId}`)).json());expect(restoredPreview.objects[0]?.object).toMatchObject({text:'Durable checkpoint',restoredFrom:'note'});expect(restoredPreview.objects[0]?.object.id).not.toBe('note');expect(restoredPreview.checkpoint).toMatchObject({sourceBoardId:board.id,sourceCheckpointId:checkpoint.id,reason:'Facilitator recovery'});
    const replay=H.RestoreReceipt.parse(await (await call('POST',`/${board.id}/checkpoints/${checkpoint.id}/restores`,restoreRequest)).json());expect(replay).toMatchObject({restoredBoardId:receipt.restoredBoardId,replayed:true});
  });
  it('blocks stale fences, revoked actors and bad restore digests without half Boards',async()=>{
    const board=await createBoard(),head=H.HistoryHead.parse(await (await call('GET',`/${board.id}/checkpoints/head`)).json());
    expect((await call('POST',`/${board.id}/checkpoints`,{requestId:randomUUID(),label:'stale',reason:'stale',retentionDays:1,expectedHead:{...head,seq:head.seq+1}})).status).toBe(409);
    const checkpoint=H.Checkpoint.parse(await (await call('POST',`/${board.id}/checkpoints`,{requestId:randomUUID(),label:'good',reason:'good',retentionDays:1,expectedHead:head})).json());
    const before=await asApp(ORG,c=>c.query<{count:string}>(`SELECT count(*)::text count FROM whiteboards WHERE org_id=$1`,[ORG]));
    expect((await call('POST',`/${board.id}/checkpoints/${checkpoint.id}/restores`,{requestId:randomUUID(),sourceContentDigest:'b'.repeat(64),boardName:'bad',reason:'bad digest',retentionDays:1})).status).toBe(400);
    const after=await asApp(ORG,c=>c.query<{count:string}>(`SELECT count(*)::text count FROM whiteboards WHERE org_id=$1`,[ORG]));expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
    expect((await call('PUT',`/${board.id}/members`,{userId:EDITOR,role:'editor'})).status).toBe(200);expect((await call('DELETE',`/${board.id}/members/${EDITOR}`)).status).toBe(200);
    expect((await call('POST',`/${board.id}/checkpoints/${checkpoint.id}/restores`,{requestId:randomUUID(),sourceContentDigest:checkpoint.contentDigest,boardName:'denied',reason:'revoked',retentionDays:1},EDITOR)).status).toBe(404);
    expect((await call('GET',`/${board.id}/checkpoints`,undefined,OUTSIDER,OTHER)).status).toBe(404);
  });
  it('keeps archived history readable while rejecting every history write',async()=>{
    const board=await createBoard(),head=H.HistoryHead.parse(await (await call('GET',`/${board.id}/checkpoints/head`)).json()),checkpoint=H.Checkpoint.parse(await (await call('POST',`/${board.id}/checkpoints`,{requestId:randomUUID(),label:'Archive',reason:'Archive policy',retentionDays:2,expectedHead:head})).json());
    expect((await call('PATCH',`/${board.id}`,{archived:true})).status).toBe(200);
    expect((await call('GET',`/${board.id}/checkpoints/${checkpoint.id}`)).status).toBe(200);
    expect((await call('POST',`/${board.id}/checkpoints`,{requestId:randomUUID(),label:'Denied',reason:'Archived',retentionDays:2,expectedHead:head})).status).toBe(403);
    const restore={requestId:randomUUID(),sourceContentDigest:checkpoint.contentDigest,boardName:'Denied',reason:'Archived',retentionDays:2};
    expect((await call('POST',`/${board.id}/checkpoints/${checkpoint.id}/restores`,restore)).status).toBe(403);expect((await call('POST',`/${board.id}/checkpoints/${checkpoint.id}/copies`,{...restore,requestId:randomUUID()})).status).toBe(403);
  });
  it('blocks expired preview/compare and purges active expiry while preserving pinned history',async()=>{
    const board=await createBoard(),head=H.HistoryHead.parse(await (await call('GET',`/${board.id}/checkpoints/head`)).json()),expired=H.Checkpoint.parse(await (await call('POST',`/${board.id}/checkpoints`,{requestId:randomUUID(),label:'Expire',reason:'Retention proof',retentionDays:1,expectedHead:head})).json()),pinned=H.Checkpoint.parse(await (await call('POST',`/${board.id}/checkpoints`,{requestId:randomUUID(),label:'Pinned',reason:'Legal hold',retentionDays:1,expectedHead:head})).json());
    await asOwner(c=>c.query(`UPDATE whiteboard_checkpoints SET retention_until=clock_timestamp()-interval '1 day',retention_state=CASE checkpoint_id WHEN $3 THEN 'pinned' ELSE 'active' END WHERE org_id=$1 AND board_id=$2 AND checkpoint_id=ANY($4::uuid[])`,[ORG,board.id,pinned.id,[expired.id,pinned.id]]));
    expect((await call('GET',`/${board.id}/checkpoints/${expired.id}`)).status).toBe(404);expect((await call('POST',`/${board.id}/checkpoints/compare`,{fromCheckpointId:expired.id,to:'current'})).status).toBe(404);expect((await call('GET',`/${board.id}/checkpoints/${pinned.id}`)).status).toBe(200);
    const purged=await (store as WhiteboardCollaborationStore&{purgeHistoryRetention(orgId:ReturnType<typeof toOrgId>,now?:Date,grace?:number):Promise<{metadata:number;blobs:number}>}).purgeHistoryRetention(toOrgId(ORG),new Date(),0);expect(purged.metadata).toBeGreaterThanOrEqual(1);
    expect((await call('GET',`/${board.id}/checkpoints/${pinned.id}`)).status).toBe(200);
  });
  it('copies live objects with remapped identities and retains deleted relationship context only in history',async()=>{
    const board=await createBoard(),frame={...object,id:'frame',kind:'frame' as const},child={...object,id:'child',parentId:'frame'},endpoint={...object,id:'endpoint'},edge={...object,id:'edge',kind:'connector' as const,connector:{from:'child',to:'endpoint'}};
    await store.writeCommands({orgId:toOrgId(ORG),userId:OWNER},board.id,{epoch:1,requestId:randomUUID(),commands:[frame,child,endpoint,edge].map(value=>({type:'create' as const,object:value}))});
    await store.writeCommands({orgId:toOrgId(ORG),userId:OWNER},board.id,{epoch:1,requestId:randomUUID(),commands:[{type:'delete',id:'frame'},{type:'delete',id:'endpoint'}]});
    const head=H.HistoryHead.parse(await (await call('GET',`/${board.id}/checkpoints/head`)).json()),checkpoint=H.Checkpoint.parse(await (await call('POST',`/${board.id}/checkpoints`,{requestId:randomUUID(),label:'Deleted context',reason:'Copy proof',retentionDays:2,expectedHead:head})).json());
    const preview=H.CheckpointPreview.parse(await (await call('GET',`/${board.id}/checkpoints/${checkpoint.id}`)).json());expect(preview.objects.find(value=>value.object.id==='frame')?.deleted).toBe(true);expect(preview.objects.find(value=>value.object.id==='child')).toMatchObject({parentDeleted:true});expect(preview.objects.find(value=>value.object.id==='edge')?.connector).toMatchObject({toDeleted:true});
    const sourceBefore=await store.head({orgId:toOrgId(ORG),userId:OWNER},board.id);
    for(const route of ['restores','copies'] as const){
      const receipt=H.RestoreReceipt.parse(await (await call('POST',`/${board.id}/checkpoints/${checkpoint.id}/${route}`,{requestId:randomUUID(),sourceContentDigest:checkpoint.contentDigest,boardName:route==='restores'?'Restored':'Copied',reason:'Identity remap',retentionDays:2})).json());
      const restoredState=await store.load({orgId:toOrgId(ORG),userId:OWNER},receipt.restoredBoardId);expect(restoredState.seq).toBe(0);
      const restoredPreview=H.CheckpointPreview.parse(await (await call('GET',`/${receipt.restoredBoardId}/checkpoints/${receipt.restoredCheckpointId}`)).json()),visible=restoredPreview.objects.filter(value=>!value.deleted).map(value=>value.object);
      expect(visible.map(value=>value.restoredFrom).sort()).toEqual(['child']);expect(visible[0]?.id).not.toBe('child');expect(visible[0]?.parentId).toBeNull();expect(visible.some(value=>value.kind==='connector')).toBe(false);
      expect(restoredPreview.objects.some(value=>value.deleted)).toBe(false);
    }
    expect(await store.head({orgId:toOrgId(ORG),userId:OWNER},board.id)).toEqual(sourceBefore);
  });
  it('deletes an organization with source/restored checkpoint provenance intact',async()=>{
    const boardResponse=await call('POST','',{requestId:randomUUID(),name:'Cleanup source'},OWNER,CLEANUP);expect(boardResponse.status).toBe(201);const board=await boardResponse.json() as {id:string};
    await store.writeCommands({orgId:toOrgId(CLEANUP),userId:OWNER},board.id,{epoch:1,requestId:randomUUID(),commands:[{type:'create',object}]});
    const head=H.HistoryHead.parse(await (await call('GET',`/${board.id}/checkpoints/head`,undefined,OWNER,CLEANUP)).json());
    const checkpoint=H.Checkpoint.parse(await (await call('POST',`/${board.id}/checkpoints`,{requestId:randomUUID(),label:'Cleanup checkpoint',reason:'Cascade proof',retentionDays:1,expectedHead:head},OWNER,CLEANUP)).json());
    const restored=await call('POST',`/${board.id}/checkpoints/${checkpoint.id}/restores`,{requestId:randomUUID(),sourceContentDigest:checkpoint.contentDigest,boardName:'Cleanup copy',reason:'Cascade proof',retentionDays:1},OWNER,CLEANUP);expect(restored.status).toBe(201);
    await resetOrgs(CLEANUP);
    const collected=await (store as WhiteboardCollaborationStore&{purgeHistoryRetention(orgId:ReturnType<typeof toOrgId>,now?:Date,grace?:number):Promise<{metadata:number;blobs:number}>}).purgeHistoryRetention(toOrgId(CLEANUP),new Date(),0);expect(collected.blobs).toBeGreaterThanOrEqual(3);
    const remaining=await asOwner(c=>c.query<{checkpoints:string;restores:string}>(`SELECT (SELECT count(*) FROM whiteboard_checkpoints WHERE org_id=$1)::text checkpoints,(SELECT count(*) FROM whiteboard_checkpoint_restores WHERE org_id=$1)::text restores`,[CLEANUP]));
    expect(remaining.rows[0]).toEqual({checkpoints:'0',restores:'0'});
    const intents=await asOwner(c=>c.query<{state:string}>(`SELECT state FROM whiteboard_history_blob_intents WHERE org_id=$1`,[CLEANUP]));expect(intents.rows.length).toBeGreaterThanOrEqual(3);expect(intents.rows.every(value=>value.state==='deleted')).toBe(true);
  });
});
