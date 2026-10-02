import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {WhiteboardOperationRequest} from '@repo/contracts/whiteboard-operation';
import type {WhiteboardConnector} from '@repo/contracts/whiteboard-document';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {apiOrigin,boardLogin,boardApi,boardHead,canonicalBoardSnapshot,createAcceptanceBoard,archiveAcceptanceBoard,object,createCommands,operate,provenance} from './board-acceptance-support';
import {runtimeSourceIdentity,observeRuntimeChunks,verifyRuntimeIdentity,sha256} from './board-runtime-evidence';
import {securityFixture} from './support/board-security-fixture';
import {connectorAuthorityTransport} from './support/connector-authority-transport';
import {connectorDurableState} from './support/connector-authority-storage';
import {deniedConnectorWrite,cancelledConnectorGesture} from './support/connector-c06-oracle.mjs';
import {verifyConnectorRuntimeManifest} from './support/connector-runtime-manifest';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';

const connector:WhiteboardConnector={from:'c06-a',to:'c06-b',fromAnchor:'right',toAnchor:'left',type:'curve',startStyle:'circle',endStyle:'diamond',lineStyle:'dashed',strokeWidth:7,label:'C06 authority',semanticRelation:'depends_on',route:{kind:'curve',startOffset:{x:140,y:70},endOffset:{x:-140,y:-40}},labelPosition:{t:.6,normalOffset:25}};
async function select(page:Page){const row=page.getByTestId('board-a11y-object-c06-edge');await row.focus();await row.press('Enter');}
async function synced(page:Page){await expect(page.getByTestId('board-sync-status')).toHaveAttribute('data-sync-phase','synced');}

test('C06 valid Connector permissions and held gesture authority lifecycle',async({browser,page:owner,request:api,baseURL},info)=>{
 test.setTimeout(300_000);expect(baseURL).toBeTruthy();const source=runtimeSourceIdentity();
 const contexts:BrowserContext[]=[],pages:Page[]=[],transport=connectorAuthorityTransport(),identities=new Map<Page,string>();let editor!:Page,viewer!:Page,commenter!:Page,outsider!:Page;
 const boards:Array<{id:string;name:string}>=[],records:unknown[]=[],screenshots:unknown[]=[],cleanup:unknown[]=[],cleanupErrors:unknown[]=[],raceProofs:Array<{id:string;durable:Awaited<ReturnType<typeof connectorDurableState>>;frameOffset:number}>=[];let foreign:Awaited<ReturnType<typeof securityFixture>>|undefined,ownerToken='',failure:unknown;
 const capture=async(phase:string,page=editor)=>{const path=info.outputPath(`${phase}.png`),bytes=await page.screenshot({path});screenshots.push({phase,path,sha256:sha256(bytes)});};
 let manifestBefore:Awaited<ReturnType<typeof verifyConnectorRuntimeManifest>>|undefined;
 try{
  manifestBefore=await verifyConnectorRuntimeManifest();records.push({phase:'runtime-manifest-before',...manifestBefore});
  foreign=await securityFixture();
  for(let index=0;index<4;index++){const context=await browser.newContext({baseURL,viewport:{width:1440,height:900}});contexts.push(context);pages.push(await context.newPage());}
  [editor,viewer,commenter,outsider]=pages as [Page,Page,Page,Page];const chunks=[owner,...pages].map(observeRuntimeChunks);transport.observe(editor,'original',()=>identities.get(editor)!);transport.observe(owner,'peer',()=>identities.get(owner)!);
  const login=async(page:Page,email:string,password:string,userId:string)=>{
   const response=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/auth/login')&&response.request().method()==='POST');
   const token=await boardLogin(page,email,password),authenticated=await response;expect(authenticated.ok()).toBe(true);const body=await authenticated.json();expect(body.userId).toBe(userId);expect(body.sessionToken).toBe(token);identities.set(page,body.userId);return token;
  };
  ownerToken=await login(owner,F.email,F.password,F.userId);const editorToken=await login(editor,F.adminEmail,F.adminPassword,F.adminUserId),viewerToken=await login(viewer,F.leadEmail,F.leadPassword,F.leadUserId),commenterToken=await login(commenter,F.memberEmail,F.memberPassword,F.memberUserId),outsiderToken=await login(outsider,foreign.email,foreign.password,foreign.userId);expect(new Set(identities.values()).size).toBe(5);
  const fresh=async(name:string)=>{
   const title=`C06 ${name}`,id=await createAcceptanceBoard(api,ownerToken,title);boards.push({id,name:title});
   for(const [userId,role] of [[F.adminUserId,'editor'],[F.leadUserId,'viewer'],[F.memberUserId,'commenter']])await boardApi(api,ownerToken,'PUT',`/whiteboards/${id}/members`,{userId,role});
   await operate(api,ownerToken,id,createCommands([object('c06-a','sticky',120,200,'A',140,100),object('c06-b','sticky',900,420,'B',140,100),{...object('c06-edge','connector',260,250,'C06 authority',640,220),connector}]));return id;
  };
  const boardId=await fresh('roles');for(const page of [owner,editor,viewer,commenter]){await page.goto(`/studio/board/${boardId}`);await synced(page);}
  for(const [token,role] of [[ownerToken,'owner'],[editorToken,'editor'],[viewerToken,'viewer'],[commenterToken,'commenter']] as const){const head=await (await boardApi(api,token,'GET',`/v1/whiteboards/${boardId}/head`)).json();expect(head.role).toBe(role);records.push({phase:'actual-server-role',role,epoch:head.epoch,seq:head.seq});}
  await outsider.goto(`/studio/board/${boardId}`);await expect(outsider.getByTestId('denied')).toBeVisible();
  const runtimeBefore=await Promise.all(chunks.map(async read=>verifyRuntimeIdentity(api,source,await read())));
  const changed={...connector,strokeWidth:11,label:'Valid full Connector denied payload'};
  const request=(id:string,userId:string,orgId:string,role:'owner'|'editor'|'viewer'|'commenter',revision:{epoch:number;seq:number})=>WhiteboardOperationRequest.parse({apiVersion:'2026-09-01',requestId:randomUUID(),boardId:id,expectedRevision:revision,actor:{kind:'human',actorId:userId,orgId,role,scopes:['board:read','board:write'],delegatedBy:null},commands:[{type:'connector',id:'c06-edge',connector:changed}],provenance:provenance('human')});
  const positiveBefore=await boardHead(api,ownerToken,boardId),positive=request(boardId,F.userId,F.orgId,'owner',positiveBefore);
  const receipt=await (await boardApi(api,ownerToken,'POST',`/v1/whiteboards/${boardId}/operations`,positive)).json();expect(receipt.revision).toEqual({epoch:positiveBefore.epoch,seq:positiveBefore.seq+1});
  const baseline=await canonicalBoardSnapshot(api,ownerToken,boardId);expect(baseline.objects.find(item=>item.id==='c06-edge')!.connector).toEqual(changed);
  const durable=await connectorDurableState(F.orgId,boardId);
  for(const [name,page,token,userId,orgId,role,status] of [
   ['viewer',viewer,viewerToken,F.leadUserId,F.orgId,'viewer',403],['commenter',commenter,commenterToken,F.memberUserId,F.orgId,'commenter',403],['outsider',outsider,outsiderToken,foreign.userId,foreign.orgId,'editor',404],
  ] as const){
   if(name!=='outsider'){await select(page);await expect(page.getByTestId('board-connector-width-open')).toBeDisabled();await expect(page.getByTestId('board-connector-label-open')).toBeDisabled();await expect(page.getByTestId('board-connector-handle-from')).toHaveCount(0);await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeDisabled();}
   const payload=request(boardId,userId,orgId,role,baseline.revision);expect(payload.commands).toEqual(positive.commands);
   const response=await api.post(`${apiOrigin()}/v1/whiteboards/${boardId}/operations`,{headers:{authorization:`Bearer ${token}`},data:payload});
   deniedConnectorWrite(durable,await connectorDurableState(F.orgId,boardId),response.status(),status);
   expect(await canonicalBoardSnapshot(api,ownerToken,boardId)).toEqual(baseline);await capture(`${name}-denied`,page);records.push({phase:`${name}-valid-payload-denied`,status:response.status(),revision:baseline.revision});
  }
  for(const race of ['lock','hide','delete','revoke','archive'] as const){
   const id=await fresh(`held-${race}`);for(const page of [owner,editor]){await page.goto(`/studio/board/${id}`);await synced(page);}
   await select(editor);const box=await editor.getByTestId('board-connector-handle-curve-start').boundingBox();expect(box).not.toBeNull();
   const before=await canonicalBoardSnapshot(api,ownerToken,id),frameOffset=transport.snapshot().events.length;
   await editor.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await editor.mouse.down();await editor.mouse.move(box!.x+box!.width/2+40,box!.y+box!.height/2+50,{steps:10});
   expect(await canonicalBoardSnapshot(api,ownerToken,id)).toEqual(before);await capture(`held-${race}`);
   if(race==='revoke')await boardApi(api,ownerToken,'DELETE',`/whiteboards/${id}/members/${F.adminUserId}`);
   else if(race==='archive')await archiveAcceptanceBoard(api,ownerToken,id);
   else await operate(api,ownerToken,id,[race==='delete'?{type:'delete',id:'c06-edge'}:{type:'state',id:'c06-edge',...(race==='lock'?{locked:true}:{hidden:true})}]);
   const afterAuthority=await connectorDurableState(F.orgId,id);
   raceProofs.push({id,durable:afterAuthority,frameOffset});
   if(race==='archive'||race==='revoke')await expect(editor.getByTestId('denied')).toBeVisible();
   else if(race==='delete')await expect(editor.getByTestId('board-a11y-object-c06-edge')).toHaveCount(0);
   else await expect(editor.getByTestId('board-connector-handle-curve-start')).toHaveCount(0);
   await editor.mouse.up();await editor.keyboard.press('Escape');
   await editor.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
   await capture(`released-${race}`);await editor.reload();
   if(race==='archive'||race==='revoke')await expect(editor.getByTestId('denied')).toBeVisible();
   else {
    await synced(editor);
    await expect.poll(()=>transport.snapshot().events.slice(frameOffset).some(event=>event.boardId===id&&event.client==='original'&&event.direction==='received'&&event.type==='sync'&&event.seq===Number(afterAuthority.document.seq))).toBe(true);
   }
   // Durable manifest/log equality is the counterproof even where public APIs hide the board.
   await expect.poll(()=>connectorDurableState(F.orgId,id)).toEqual(afterAuthority);
   const frames=transport.snapshot().events.slice(frameOffset).filter(event=>event.boardId===id&&event.client==='original');cancelledConnectorGesture(afterAuthority,await connectorDurableState(F.orgId,id),frames);
   if(race!=='archive'){const snapshot=await canonicalBoardSnapshot(api,ownerToken,id);expect(snapshot.revision).toEqual({epoch:afterAuthority.document.epoch,seq:Number(afterAuthority.document.seq)});if(race!=='delete')expect(snapshot.objects.find(item=>item.id==='c06-edge')!.connector).toEqual(connector);}
   await capture(`reloaded-${race}`);records.push({phase:`held-${race}-cancelled`,before:before.revision,durable:afterAuthority,transport:frames});
  }
  const runtimeAfter=await Promise.all(chunks.map(async read=>verifyRuntimeIdentity(api,source,await read())));expect(transport.snapshot().dropped).toBe(0);
  for(const proof of raceProofs){const tail=transport.snapshot().events.slice(proof.frameOffset).filter(event=>event.boardId===proof.id&&event.client==='original');cancelledConnectorGesture(proof.durable,await connectorDurableState(F.orgId,proof.id),tail);records.push({phase:'runner-final-cancellation-proof',boardId:proof.id,transport:tail});}
  records.push({runtimeBefore,runtimeAfter,identities:[...identities.values()]});
 }catch(error){failure=error;}
 finally{
  for(const board of boards){try{cleanup.push(await deleteOwnedConnectorFixture(api,ownerToken,board.id,F.userId,board.name));}catch(error){cleanupErrors.push(error);}}
  for(const context of contexts){try{await context.close();}catch(error){cleanupErrors.push(error);}}
  if(foreign){try{await foreign.cleanup();}catch(error){cleanupErrors.push(error);}}
  try{expect(manifestBefore).toBeTruthy();records.push({phase:'runtime-manifest-after',...await verifyConnectorRuntimeManifest(manifestBefore)});}catch(error){cleanupErrors.push(error);}
  if(cleanupErrors.length)failure=new AggregateError([...(failure?[failure]:[]),...cleanupErrors],'Connector authority execution/cleanup failures');
  const path=info.outputPath('connector-authority-result.json');await writeFile(path,JSON.stringify({source,status:failure?'failed':'C06-authority-subcases-passed',requiredRoundComplete:false,records,screenshots,cleanup,pending:['actual production runtime execution and independent visual review','C07 history','C08 interchange','390px authority cases']},null,2),{mode:0o600});await info.attach('connector-authority-result',{path,contentType:'application/json'});
 }
 if(failure)throw failure;
});
