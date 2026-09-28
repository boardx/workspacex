import {strict as assert} from 'node:assert';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {expect,type APIRequestContext,type Page} from '@playwright/test';
import type {WhiteboardObject} from '@repo/contracts/whiteboard-document';
import {assertVendorLocalObjects,assertPortableCanonicalRoundtrip,readVendorLocalNodes,type VendorLocalObject} from './board-vendor-local-proof';
export type VendorExpected={sourceId:string;outcome:'success'|'downgraded'|'skipped'|'failed';reasonCode?:string;kind?:string;text?:string;zIndex?:number;style?:Record<string,unknown>;geometry?:{x:number;y:number;width:number;height:number;rotation:number};parentSourceId?:string|null;fromSourceId?:string;toSourceId?:string;lossIncludes?:string[]};
export type VendorMigrationFixture={source:'miro'|'mural';name:string;mime:'application/json'|'application/zip'|'text/csv';bytes:Buffer;sha256:string;classification:'captured-account-export'|'schema-derived-synthetic';sourceEvidence:string[];expected:VendorExpected[];media?:Array<{sourceId:string;sha256:string;width:number;height:number;pixelProbe:[number,number,number]}>};
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** No vendor parser is used to build expected output. Supply an independently
 * reviewed full inventory, including every lost source item and every field. */
export function assertVendorMigration(fixture:VendorMigrationFixture,report:any,objects:any[]){
 assert.equal(report.counts.discovered,fixture.expected.length);assert.equal(report.counts.accepted,fixture.expected.filter(item=>['success','downgraded'].includes(item.outcome)).length);assert.equal(report.counts.unsupported,fixture.expected.filter(item=>['skipped','failed'].includes(item.outcome)).length);assert.equal(report.items.length,fixture.expected.length);
 const actual=new Map(objects.map(object=>[object.extensionData?.import?.sourceId,object]));
 assert.equal(actual.size,objects.length);assert.equal(objects.length,fixture.expected.filter(item=>['success','downgraded'].includes(item.outcome)).length);
 const expectedIds=new Set(fixture.expected.map(item=>item.sourceId));assert.equal(expectedIds.size,fixture.expected.length);
 for(const expected of fixture.expected){const entry=report.items.filter((item:any)=>item.sourceId===expected.sourceId);assert.equal(entry.length,1);assert.equal(entry[0].outcome,expected.outcome);if(expected.reasonCode)assert.equal(entry[0].reasonCode,expected.reasonCode);
  for(const loss of expected.lossIncludes??[])assert(report.issues.some((issue:any)=>issue.sourceId===expected.sourceId&&issue.detail.includes(loss)),`missing loss ${expected.sourceId}: ${loss}`);
  const object=actual.get(expected.sourceId);if(!['success','downgraded'].includes(expected.outcome)){assert.equal(object,undefined);continue;}assert(object);
  assert(expected.kind&&expected.geometry&&expected.text!==undefined&&expected.parentSourceId!==undefined,'accepted inventory requires kind/text/full geometry/parent expectation');assert.equal(object.kind,expected.kind);assert.equal(object.zIndex,expected.zIndex);for(const [key,value] of Object.entries(expected.style??{}))assert.deepEqual(object.style[key],value);if(expected.text!==undefined)assert.equal(object.text,expected.text);if(expected.geometry)assert.deepEqual(object.geometry,expected.geometry);
  if(expected.parentSourceId!==undefined)assert.equal(object.parentId,expected.parentSourceId?actual.get(expected.parentSourceId)?.id:null);
  if(expected.fromSourceId)assert.equal(object.connector?.from,actual.get(expected.fromSourceId)?.id);if(expected.toSourceId)assert.equal(object.connector?.to,actual.get(expected.toSourceId)?.id);
 }
}
/** Real isolated stack producer. Caller supplies authenticated pages in separate
 * browser contexts and owns services/cleanup. Synthetic runs are diagnostics,
 * never counted as the three real-account migration boards. */
export async function produceVendorMigrationEvidence(input:{api:APIRequestContext;apiUrl:string;ownerToken:string;peerUserId:string;owner:Page;peer:Page;fixture:VendorMigrationFixture}){
 const f=input.fixture;assert.equal(hash(f.bytes),f.sha256);assert(f.sourceEvidence.length>0);assert.notEqual(input.owner.context(),input.peer.context(),'peer must be an independent context');
 const call=async(method:string,path:string,data?:unknown)=>{const r=await input.api.fetch(`${input.apiUrl}${path}`,{method,headers:{Authorization:`Bearer ${input.ownerToken}`},data});assert(r.ok(),`${method} ${path}: ${r.status()} ${await r.text()}`);return r;};
 const board=await(await call('POST','/whiteboards',{requestId:randomUUID(),name:`Migration ${f.name} ${randomUUID()}`})).json(),path=`/whiteboards/${board.id}/imports`;
 const uploaded=await(await call('POST',path,{requestId:randomUUID(),source:f.source,fileName:f.name,mimeType:f.mime,sizeBytes:f.bytes.length,sha256:f.sha256,contentBase64:f.bytes.toString('base64')})).json();
 const preflight=await(await call('POST',`${path}/${uploaded.importId}/preflight`,{requestId:randomUUID()})).json();assert(preflight.executable);
 const requestId=randomUUID(),execute={requestId,expectedEpoch:1};const accepted=await(await call('POST',`${path}/${uploaded.importId}/execute`,execute)).json();
 const replay=await(await call('POST',`${path}/${uploaded.importId}/execute`,execute)).json();assert.equal(replay.replayed,true);assert.equal(replay.seq,accepted.seq);
 const report=await(await call('GET',`${path}/${uploaded.importId}/report`)).json();assert.deepEqual(report,accepted.report);assert.deepEqual(report,preflight);
 const canonical=async(targetBoardId=board.id):Promise<{objects:WhiteboardObject[]}>=>{const exported=await(await call('POST',`/whiteboards/${targetBoardId}/imports/standard-export`,{requestId:randomUUID()})).json(),download=await(await call('GET',exported.downloadPath)).json(),bytes=Buffer.from(download.contentBase64,'base64');assert.equal(hash(bytes),download.sha256);return JSON.parse(bytes.toString());};
 const document=await canonical();assertVendorMigration(f,report,document.objects);const images=[];
 const imageSourceIds=document.objects.filter(o=>o.kind==='image').map(o=>(o.extensionData?.import as {sourceId:string}).sourceId).sort();
 assert.deepEqual((f.media??[]).map(m=>m.sourceId).sort(),imageSourceIds,'every accepted image requires independent byte/pixel expectations');
 const sharp=createRequire(resolve(__dirname,'../../../api/package.json'))('sharp') as (bytes:Uint8Array)=>{raw():{toBuffer(options:{resolveWithObject:true}):Promise<{data:Buffer;info:{width:number;height:number;channels:number}}>}};
 for(const media of f.media??[]){const object=document.objects.find((o:any)=>o.extensionData?.import?.sourceId===media.sourceId),asset=object?.extensionData?.contentObject as {status?:string;assetId?:string}|undefined;assert(asset);assert.equal(asset.status,'ready');const response=await call('GET',`/whiteboards/${board.id}/assets/${asset.assetId}/content`),bytes=await response.body();assert.equal(hash(bytes),media.sha256);const pixels=await sharp(bytes).raw().toBuffer({resolveWithObject:true});assert.equal(pixels.info.width,media.width);assert.equal(pixels.info.height,media.height);let probe=0;for(let i=0;i<pixels.data.length;i+=pixels.info.channels)if(media.pixelProbe.every((value,index)=>pixels.data[i+index]===value))probe++;assert(probe>100,'pixel probe must occur in the actual source image');images.push({assetId:asset.assetId,sha256:media.sha256,pixelHash:hash(pixels.data)});}
 await call('PUT',`/whiteboards/${board.id}/members`,{userId:input.peerUserId,role:'editor'});
 const verifyPage=async(page:Page,expected:WhiteboardObject[])=>{await expect(page.getByTestId('collaborative-editor')).toBeVisible();await expect(page.getByText(/^已同步/)).toBeVisible();await page.getByTestId('board-zoom-fit-board').click();
 // Observe this page's local rendered model, never refetch the server as a substitute.
 await expect(async()=>assertVendorLocalObjects(await readVendorLocalObjects(page),expected)).toPass({timeout:15_000});
 for(const media of f.media??[])await expect.poll(()=>page.locator('canvas.lower-canvas').evaluateAll((elements,rgb)=>elements.some(element=>{const c=element as HTMLCanvasElement,ctx=c.getContext('2d');if(!ctx)return false;const bytes=ctx.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]===rgb[0]&&bytes[i+1]===rgb[1]&&bytes[i+2]===rgb[2]&&bytes[i+3]===255)n++;return n>100;}),media.pixelProbe)).toBe(true);};
 await input.owner.goto(`/studio/board/${board.id}`);await verifyPage(input.owner,document.objects);const initialLocal=await readVendorLocalObjects(input.owner);
 await input.owner.reload();await verifyPage(input.owner,document.objects);const reloadedLocal=await readVendorLocalObjects(input.owner);
 await input.peer.goto(`/studio/board/${board.id}`);await verifyPage(input.peer,document.objects);const peerLocal=await readVendorLocalObjects(input.peer);
 assert.deepEqual((await canonical()).objects,document.objects);
 const ownerScreenshot=await input.owner.screenshot(),peerScreenshot=await input.peer.screenshot();
 // Exercise the media-bearing public package, not the legacy media-free JSON export.
 const portable=await(await call('POST',`/whiteboards/${board.id}/portable/export`)).json();
 const bundleBytes=Buffer.from(portable.contentBase64,'base64');assert.equal(bundleBytes.length,portable.sizeBytes);assert.equal(hash(bundleBytes),portable.sha256);
 const bundle=JSON.parse(bundleBytes.toString('utf8'));assert.equal(bundle.format,'workspacex.board.bundle.v1');
 assert.deepEqual(bundle.objects.content,document.objects);const objectBytes=Buffer.from(JSON.stringify(bundle.objects.content));assert.equal(bundle.objects.sizeBytes,objectBytes.length);assert.equal(bundle.objects.sha256,hash(objectBytes));
 assert.equal(bundle.media.length,new Set(document.objects.filter(o=>o.kind==='image').map(o=>(o.extensionData?.contentObject as {assetId:string}).assetId)).size);
 const roundtripBoard=await(await call('POST','/whiteboards',{requestId:randomUUID(),name:`Migration roundtrip ${randomUUID()}`})).json();
 const portableInput={requestId:randomUUID(),expectedEpoch:1,file:{sizeBytes:portable.sizeBytes,sha256:portable.sha256,contentBase64:portable.contentBase64}};
 const portableAccepted=await(await call('POST',`/whiteboards/${roundtripBoard.id}/portable/import`,portableInput)).json();
 const portableReplay=await(await call('POST',`/whiteboards/${roundtripBoard.id}/portable/import`,portableInput)).json();
 assert.equal(portableReplay.replayed,true);assert.equal(portableReplay.epoch,portableAccepted.epoch);assert.equal(portableReplay.seq,portableAccepted.seq);
 const roundtrip=await canonical(roundtripBoard.id);assertPortableCanonicalRoundtrip(document.objects,roundtrip.objects);
 const mediaRoundtrip=[];
 for(const source of document.objects.filter(o=>o.kind==='image')){
  const sourceIdentity=(source.extensionData?.import as {sourceId:string}).sourceId;
  const target=roundtrip.objects.find(o=>(o.extensionData?.import as {sourceId?:string})?.sourceId===sourceIdentity);assert(target);
  const assetId=(o:WhiteboardObject)=>(o.extensionData?.contentObject as {assetId:string}).assetId;
  const sourceBytes=await(await call('GET',`/whiteboards/${board.id}/assets/${assetId(source)}/content`)).body();
  const targetBytes=await(await call('GET',`/whiteboards/${roundtripBoard.id}/assets/${assetId(target)}/content`)).body();
  assert.deepEqual(targetBytes,sourceBytes,'portable target authenticated image bytes changed');
  const entry=bundle.media.filter((m:{assetId:string})=>m.assetId===assetId(source));assert.equal(entry.length,1);
  assert.deepEqual(Buffer.from(entry[0].contentBase64,'base64'),sourceBytes);assert.equal(entry[0].sha256,hash(sourceBytes));assert.equal(entry[0].sizeBytes,sourceBytes.length);
  mediaRoundtrip.push({sourceId:sourceIdentity,sha256:hash(targetBytes),sizeBytes:targetBytes.length});
 }
 await call('PUT',`/whiteboards/${roundtripBoard.id}/members`,{userId:input.peerUserId,role:'editor'});
 await input.owner.goto(`/studio/board/${roundtripBoard.id}`);await verifyPage(input.owner,roundtrip.objects);
 await input.owner.reload();await verifyPage(input.owner,roundtrip.objects);const roundtripOwnerLocal=await readVendorLocalObjects(input.owner);
 await input.peer.goto(`/studio/board/${roundtripBoard.id}`);await verifyPage(input.peer,roundtrip.objects);const roundtripPeerLocal=await readVendorLocalObjects(input.peer);
 assert.deepEqual((await canonical(roundtripBoard.id)).objects,roundtrip.objects);
 const localHash=(rows:VendorLocalObject[])=>hash(Buffer.from(JSON.stringify(rows)));
 return{boardId:board.id,roundtripBoardId:roundtripBoard.id,sourceHash:f.sha256,classification:f.classification,realBoardAcceptance:f.classification==='captured-account-export'?'requires-source-evidence-review':'diagnostic-only',sourceEvidence:f.sourceEvidence,accepted,replay,report,images,
  localEvidence:{objectCount:document.objects.length,initialHash:localHash(initialLocal),reloadedHash:localHash(reloadedLocal),peerHash:localHash(peerLocal)},
  portableEvidence:{bundleSha256:portable.sha256,accepted:portableAccepted,replay:portableReplay,media:mediaRoundtrip,ownerLocalHash:localHash(roundtripOwnerLocal),peerLocalHash:localHash(roundtripPeerLocal)},
  ownerScreenshot,peerScreenshot,roundtripOwnerScreenshot:await input.owner.screenshot(),roundtripPeerScreenshot:await input.peer.screenshot()};
}

/** Read only the live page's existing accessibility mirror. No test injection,
 * global Y.Doc hooks, server fetches or production adapter imports are used. */
export async function readVendorLocalObjects(page:Page):Promise<VendorLocalObject[]>{
 return page.getByTestId('board-a11y-mirror').locator('li[data-object-id]').evaluateAll(readVendorLocalNodes);
}
