import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {PortableExportResult,PortableImportResult} from '@repo/contracts/whiteboard-portable';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {boardLogin,boardApi,apiOrigin,boardHead,canonicalBoardSnapshot,createAcceptanceBoard,object,createCommands,operate} from './board-acceptance-support';
import {runtimeSourceIdentity,observeRuntimeChunks,verifyRuntimeIdentity,sha256} from './board-runtime-evidence';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';
import {exactInterchangeObjects,portableExportProof,portableObjectExpectation} from './support/connector-c08-oracle.mjs';

for(const viewport of [{width:1440,height:900},{width:390,height:844}])test(`C08 actual portable and legacy standard HTTP interchange at ${viewport.width}px preserves complete bound and free Connector fields`,async({page,request:api},info)=>{
 test.setTimeout(240_000);await page.setViewportSize(viewport);const source=runtimeSourceIdentity(),chunks=observeRuntimeChunks(page),records:unknown[]=[],screenshots:unknown[]=[],owned:Array<{id:string;title:string}>=[],cleanupErrors:unknown[]=[];let token='',failure:unknown;
 const make=async(title:string)=>{const id=await createAcceptanceBoard(api,token,title);owned.push({id,title});return id;};
 const capture=async(id:string,phase:string,expected:unknown[])=>{
  await page.goto(`/studio/board/${id}`);await expect(page.getByTestId('board-sync-status')).toHaveAttribute('data-sync-phase','synced');
  await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(expected.length);
  const before=await canonicalBoardSnapshot(api,token,id);exactInterchangeObjects(expected,before.objects);
  const path=info.outputPath(`${phase}.png`),bytes=await page.screenshot({path});screenshots.push({phase,path,sha256:sha256(bytes)});
  await page.reload();await expect(page.getByTestId('board-sync-status')).toHaveAttribute('data-sync-phase','synced');exactInterchangeObjects(expected,(await canonicalBoardSnapshot(api,token,id)).objects);
  expect((await canonicalBoardSnapshot(api,token,id)).revision).toEqual(before.revision);
 };
 try{
  const loginResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/auth/login')&&response.request().method()==='POST');token=await boardLogin(page);const login=await (await loginResponse).json();expect(login.userId).toBe(F.userId);expect(login.sessionToken).toBe(token);
  for(const type of ['straight','elbow','curve'] as const){
   const sourceId=await make(`C08 ${type} source`),sourceObjects=[object('c08-a','sticky',150,180,'A',140,100),object('c08-b','sticky',850,420,'B',140,100)];
   const route=type==='curve'?{kind:'curve' as const,startOffset:{x:100,y:-70},endOffset:{x:-80,y:25}}:type==='elbow'?{kind:'elbow' as const,waypoints:[{x:450,y:230},{x:450,y:470}]}:undefined;
   const advanced={fromAnchor:'right' as const,toAnchor:'left' as const,type,route,strokeWidth:24,label:'中文 English C08',semanticRelation:'depends_on',labelPosition:{t:.73,normalOffset:-29},startStyle:'circle' as const,endStyle:'diamond' as const,lineStyle:'dotted' as const};
   const edges=[{...object('c08-bound','connector',290,230,'中文 English C08',560,240),style:{stroke:'#E11D48'},connector:{...advanced,from:'c08-a',to:'c08-b'}},{...object('c08-free','connector',250,650,'中文 English C08',650,0),style:{stroke:'#E11D48'},connector:{...advanced,fromPoint:{x:250,y:650},toPoint:{x:900,y:650}}}];
   await operate(api,token,sourceId,createCommands([...sourceObjects,...edges]));const before=await canonicalBoardSnapshot(api,token,sourceId);await capture(sourceId,`${type}-source`,before.objects);
   records.push({phase:'runtime-before',type,identity:await verifyRuntimeIdentity(api,source,await chunks())});
   const exported=PortableExportResult.parse(await (await boardApi(api,token,'POST',`/whiteboards/${sourceId}/portable/export`,{})).json());portableExportProof(exported,before.objects,before.revision);
   const portableTarget=await make(`C08 ${type} portable target`),requestId=randomUUID(),emptyHead=await boardHead(api,token,portableTarget),receipt=PortableImportResult.parse(await (await boardApi(api,token,'POST',`/whiteboards/${portableTarget}/portable/import`,{requestId,expectedEpoch:emptyHead.epoch,file:{contentBase64:exported.contentBase64,sha256:exported.sha256,sizeBytes:exported.sizeBytes}})).json());
   expect(receipt).toMatchObject({epoch:emptyHead.epoch,seq:emptyHead.seq+1,objectCount:4,assetCount:0,replayed:false});const expected=portableObjectExpectation(before.objects,requestId);await capture(portableTarget,`${type}-portable-import`,expected);
   const standard=await (await boardApi(api,token,'POST',`/whiteboards/${sourceId}/imports/standard-export`,{requestId:randomUUID()})).json(),download=await (await boardApi(api,token,'GET',standard.downloadPath)).json();
   const bytes=Buffer.from(download.contentBase64,'base64');expect(bytes.length).toBe(standard.sizeBytes);expect(sha256(bytes)).toBe(standard.sha256);const standardContent=JSON.parse(bytes.toString('utf8'));expect(standardContent.format).toBe('workspacex.board.v1');expect(standardContent.board).toEqual({id:sourceId,...before.revision});exactInterchangeObjects(before.objects,standardContent.objects);
   const standardTarget=await make(`C08 ${type} standard target`),standardRequest=randomUUID(),standardHead=await boardHead(api,token,standardTarget),standardReceipt=PortableImportResult.parse(await (await boardApi(api,token,'POST',`/whiteboards/${standardTarget}/portable/import`,{requestId:standardRequest,expectedEpoch:standardHead.epoch,file:{contentBase64:download.contentBase64,sha256:download.sha256,sizeBytes:download.sizeBytes}})).json());expect(standardReceipt).toEqual({epoch:standardHead.epoch,seq:standardHead.seq+1,objectCount:4,assetCount:0,replayed:false});expect(await boardHead(api,token,standardTarget)).toEqual({epoch:standardHead.epoch,seq:standardHead.seq+1});await capture(standardTarget,`${type}-standard-import`,portableObjectExpectation(before.objects,standardRequest));
   const rejectionTarget=await make(`C08 ${type} rejection target`),unchanged=await canonicalBoardSnapshot(api,token,rejectionTarget);
   for(const mutation of ['invalid-width','invalid-route','dangling-reference','inner-digest'] as const){
    const bundle=JSON.parse(Buffer.from(exported.contentBase64,'base64').toString('utf8')),edge=bundle.objects.content.find((item:{id:string})=>item.id==='c08-bound');
    if(mutation==='invalid-width')edge.connector.strokeWidth=0;
    if(mutation==='invalid-route')edge.connector.route={kind:'curve',startOffset:{x:'invalid',y:0},endOffset:{x:0,y:0}};
    if(mutation==='dangling-reference')edge.connector.from='absent-object';
    const objectBytes=Buffer.from(JSON.stringify(bundle.objects.content));bundle.objects.sizeBytes=objectBytes.length;bundle.objects.sha256=mutation==='inner-digest'?'0'.repeat(64):sha256(objectBytes);const damagedBytes=Buffer.from(JSON.stringify(bundle));
    const response=await api.post(`${apiOrigin()}/whiteboards/${rejectionTarget}/portable/import`,{headers:{authorization:`Bearer ${token}`},data:{requestId:randomUUID(),expectedEpoch:unchanged.revision.epoch,file:{contentBase64:damagedBytes.toString('base64'),sha256:sha256(damagedBytes),sizeBytes:damagedBytes.length}}});
    expect(response.status()).toBe(mutation==='inner-digest'?503:400);const body=await response.json();expect(body.reasonCode).toBe(mutation==='inner-digest'?'INTEGRITY_FAILED':'INVALID_UPLOAD');expect(await canonicalBoardSnapshot(api,token,rejectionTarget)).toEqual(unchanged);records.push({phase:'rejected-import',type,mutation,status:response.status(),reasonCode:body.reasonCode});
   }
   expect(await canonicalBoardSnapshot(api,token,sourceId)).toEqual(before);records.push({phase:'interchange',type,sourceRevision:before.revision,portableRevision:{epoch:receipt.epoch,seq:receipt.seq},exportDigest:exported.sha256});
  }
  records.push({phase:'runtime-after',identity:await verifyRuntimeIdentity(api,source,await chunks())});
 }catch(error){failure=error;}
 finally{
  for(const board of owned){try{records.push({phase:'cleanup',...await deleteOwnedConnectorFixture(api,token,board.id,F.userId,board.title)});}catch(error){cleanupErrors.push(error);}}
  if(cleanupErrors.length)failure=new AggregateError([...(failure?[failure]:[]),...cleanupErrors],'Connector interchange execution/cleanup failures');
  const path=info.outputPath('connector-interchange-result.json');await writeFile(path,JSON.stringify({source,viewport,status:failure?'failed':'C08-HTTP-interchange-subcases-passed',requiredC08Complete:false,requiredRoundComplete:false,records,screenshots,pending:['actual runtime and independent screenshot review','separate UI copy/default driver execution']},null,2),{mode:0o600});await info.attach('connector-interchange-result',{path,contentType:'application/json'});
 }
 if(failure)throw failure;
});
