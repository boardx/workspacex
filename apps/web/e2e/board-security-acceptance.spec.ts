import {test,expect} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import * as Y from 'yjs';
import {createWhiteboardDocument,executeCommands} from '@repo/whiteboard-core';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {apiOrigin,boardLogin,boardApi,createAcceptanceBoard,archiveAcceptanceBoard,boardHead,object,createCommands,operate,openBoard,provenance} from './board-acceptance-support';
import {canonicalSnapshot} from './board-performance-support';
import {runtimeSourceIdentity,observeRuntimeChunks,verifyRuntimeIdentity} from './board-runtime-evidence';
import {securityFixture,shortLivedSecuritySession} from './support/board-security-fixture';
import {securitySocket} from './support/board-security-websocket';

test('security real tenant API WS and durable image authorization counterproofs',async({browser,page,request,baseURL},info)=>{
 const sha=runtimeSourceIdentity(),chunks=observeRuntimeChunks(page),foreign=await securityFixture();
 const contexts=await Promise.all([1,2,3].map(()=>browser.newContext({baseURL}))),peers=await Promise.all(contexts.map(c=>c.newPage()));
 const observations:Array<Record<string,unknown>>=[];const boards:string[]=[];let owner='';
 const record=(name:string,value:Record<string,unknown>)=>observations.push({name,at:new Date().toISOString(),...value});
 try{
  owner=await boardLogin(page);const viewer=await boardLogin(peers[0]!,F.leadEmail,F.leadPassword),commenter=await boardLogin(peers[1]!,F.adminEmail,F.adminPassword),outsider=await boardLogin(peers[2]!,foreign.email,foreign.password);
  const board=await createAcceptanceBoard(request,owner,'Security source'),other=await createAcceptanceBoard(request,owner,'Security other');boards.push(board,other);
  await operate(request,owner,board,createCommands([object('security-sticky','sticky',100,100,'private content')]));
  await boardApi(request,owner,'PUT',`/whiteboards/${board}/members`,{userId:F.leadUserId,role:'viewer'});
  await boardApi(request,owner,'PUT',`/whiteboards/${board}/members`,{userId:F.adminUserId,role:'commenter'});
  await openBoard(page,board,1);const runtimeBefore=await verifyRuntimeIdentity(request,sha,await chunks());
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=48;c.getContext('2d')!.fillRect(0,0,64,48);return c.toDataURL('image/png').split(',')[1]!;});
  const upload=await request.post(`${apiOrigin()}/whiteboards/${board}/assets`,{headers:{authorization:`Bearer ${owner}`},multipart:{file:{name:'private.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')}}});expect(upload.ok()).toBe(true);
  const asset=await upload.json();expect(asset.persistence).toBe('durable');expect(asset.assetId).toMatch(/^board-image-[a-f0-9]{64}$/);
  const imagePath=`/whiteboards/${board}/assets/${asset.assetId}/content`,baseline=await canonicalSnapshot(request,owner,board);
  async function http(name:string,token:string,path:string,method='GET',data?:unknown,allowed=[403,404]){
   const response=await request.fetch(apiOrigin()+path,{method,headers:{authorization:`Bearer ${token}`},data});const body=await response.body();record(name,{status:response.status(),bytes:body.length,contentType:response.headers()['content-type']??'',bodyHash:createHash('sha256').update(body).digest('hex')});expect(allowed).toContain(response.status());return response;
  }
  const positive=await http('owner-image',owner,imagePath,'GET',undefined,[200]);expect(await positive.body()).toEqual(Buffer.from(png,'base64'));expect(positive.headers()['cache-control']).toBe('private, no-store');
  await http('viewer-image',viewer,imagePath,'GET',undefined,[200]);
  const command=(userId:string)=>({apiVersion:'2026-09-01',requestId:randomUUID(),boardId:board,expectedRevision:baseline.revision,actor:{kind:'human',actorId:userId,orgId:F.orgId,role:'owner',scopes:['board:read','board:write'],delegatedBy:null},commands:createCommands([object('forbidden-write','sticky',500,500)]),provenance:provenance('human')});
  const doc=createWhiteboardDocument();executeCommands(doc,createCommands([object('forbidden-ws','sticky',500,500)]),'security-counterproof');const update=Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');doc.destroy();
  for(const [role,token,userId,peer]of [['viewer',viewer,F.leadUserId,peers[0]!],['commenter',commenter,F.adminUserId,peers[1]!]] as const){
   await http(`${role}-read`,token,`/v1/whiteboards/${board}/objects`,'GET',undefined,[200]);
   await http(`${role}-write`,token,`/v1/whiteboards/${board}/operations`,'POST',command(userId),[403]);
   const ws=await securitySocket(peer,token,board,update);record(`${role}-ws-write`,ws);expect(ws.sync).toBe(true);expect(ws.ack).toBe(false);expect(ws.error).toBe('FORBIDDEN');
  }
  await http('tenant-read',outsider,`/v1/whiteboards/${board}/objects`);await http('tenant-image',outsider,imagePath);
  const ownerWs=await securitySocket(page,owner,board);record('owner-ws',ownerWs);expect(ownerWs.sync).toBe(true);
  const tenantWs=await securitySocket(peers[2]!,outsider,board);record('tenant-ws',tenantWs);expect(tenantWs.sync).toBe(false);expect(tenantWs.closed||tenantWs.error!==null).toBe(true);
  await http('cross-board-image',owner,`/whiteboards/${other}/assets/${asset.assetId}/content`);
  await peers[0]!.goto(`/studio/board/${board}`);await expect(peers[0]!.getByTestId('collaborative-editor')).toBeVisible();await expect(peers[0]!.getByText(/^已同步/)).toBeVisible();
  await boardApi(request,owner,'DELETE',`/whiteboards/${board}/members/${F.leadUserId}`);await expect(peers[0]!.getByTestId('denied')).toBeVisible();await expect(peers[0]!.getByTestId('collaborative-editor')).toHaveCount(0);record('revoked-live-view',{cleared:true});
  await http('revoked-image',viewer,imagePath);await http('revoked-read',viewer,`/v1/whiteboards/${board}/objects`);
  const revokedWs=await securitySocket(peers[0]!,viewer,board);record('revoked-ws',revokedWs);expect(revokedWs.sync).toBe(false);
  const expiry=await shortLivedSecuritySession();await http('expiry-positive',expiry.token,`/v1/whiteboards/${board}/objects`,'GET',undefined,[200]);
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,expiry.expiresAt-Date.now()+250)));record('expiry-window',{issuedAt:expiry.issuedAt,expiresAt:expiry.expiresAt,observedAt:Date.now()});
  await http('expired-read',expiry.token,`/v1/whiteboards/${board}/objects`,'GET',undefined,[401]);await http('expired-image',expiry.token,imagePath,'GET',undefined,[401]);
  const expiredWs=await securitySocket(page,expiry.token,board);record('expired-ws',expiredWs);expect(expiredWs.sync).toBe(false);
  const after=await canonicalSnapshot(request,owner,board);expect(after).toEqual(baseline);record('no-unauthorized-mutation',{before:baseline,after});
  const runtimeAfter=await verifyRuntimeIdentity(request,sha,runtimeBefore.chunks);
  await writeFile(info.outputPath('security-result.json'),JSON.stringify({version:1,kind:'board-security',sha,runtimeBefore,runtimeAfter,observations,identities:{owner:F.userId,viewer:F.leadUserId,commenter:F.adminUserId,outsider:foreign.userId,orgId:F.orgId,foreignOrgId:foreign.orgId},boardId:board,otherBoardId:other,approved:false,score:null},null,2),{mode:0o600});
 }finally{for(const id of boards)await archiveAcceptanceBoard(request,owner,id);await Promise.all(contexts.map(c=>c.close()));await foreign.cleanup();}
});
