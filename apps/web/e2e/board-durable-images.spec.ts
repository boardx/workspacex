import {observeRuntimeChunks,runtimeSourceIdentity,verifyRuntimeIdentity} from './board-runtime-evidence';
import { createHash, randomUUID } from 'node:crypto';
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { FULLSTACK_E2E as F } from './fullstack-smoke-fixture';
import { SESSION_TOKEN_STORAGE_KEY } from '../lib/api-client';
import { produceImageStorageEvidence } from './support/board-durable-images-storage';
import {boardImagePngFixture} from './support/board-image-fixture';
function origin(){const value=process.env.WHITEBOARD_API_URL??(process.env.WORKSPACEX_API_PORT?`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`:undefined);if(!value)throw new Error('WHITEBOARD_API_URL required');return value;}
async function call(api:APIRequestContext,token:string,method:string,path:string,data?:unknown){const r=await api.fetch(`${origin()}${path}`,{method,headers:{Authorization:`Bearer ${token}`},data});expect(r.ok(),`${method} ${path}: ${r.status()}`).toBe(true);return r;}
async function login(page:Page,peer=false){await page.goto('/login');await page.getByTestId('login-email').fill(peer?F.leadEmail:F.adminEmail);await page.getByTestId('login-password').fill(peer?F.leadPassword:F.adminPassword);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/(?:home|projects)$/);return(await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY))!;}
async function canonical(api:APIRequestContext,token:string,id:string){const result=await(await call(api,token,'POST',`/whiteboards/${id}/imports/standard-export`,{requestId:randomUUID()})).json();const downloaded=await(await call(api,token,'GET',result.downloadPath)).json();const bytes=Buffer.from(downloaded.contentBase64,'base64');expect(createHash('sha256').update(bytes).digest('hex')).toBe(downloaded.sha256);return JSON.parse(bytes.toString()) as {board:{epoch:number;seq:number};objects:Array<{kind:string;extensionData?:{contentObject?:Record<string,unknown>}}>};}
type Evidence={created:string[];revoked:string[];loaded:Array<{url:string;width:number;height:number}>};
async function observe(page:Page){await page.addInitScript(()=>{const state={created:[] as string[],revoked:[] as string[],loaded:[] as Array<{url:string;width:number;height:number}>};(window as unknown as {__images:typeof state}).__images=state;const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);state.created.push(url);return url;};URL.revokeObjectURL=url=>{state.revoked.push(url);revoke(url);};const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src')!;Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value:string){if(value.startsWith('blob:'))this.addEventListener('load',()=>state.loaded.push({url:value,width:this.naturalWidth,height:this.naturalHeight}),{once:true});descriptor.set!.call(this,value);}});});}
async function painted(page:Page){await expect.poll(()=>page.evaluate(()=>(window as unknown as {__images:Evidence}).__images.loaded.some(image=>image.width===64&&image.height===48))).toBe(true);await expect.poll(()=>page.locator('canvas.lower-canvas').evaluateAll(canvases=>canvases.some(element=>{const canvas=element as HTMLCanvasElement,ctx=canvas.getContext('2d');if(!ctx)return false;const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data;let matching=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]===231&&bytes[i+1]===29&&bytes[i+2]===73&&bytes[i+3]===255)matching++;return matching>100;}))).toBe(true);}

test('durable image bytes survive refresh, independent peer, revoke and source deletion',async({browser,request:api,baseURL},info)=>{
 expect(baseURL,'WHITEBOARD_WEB_URL or isolated WORKSPACEX_WEB_PORT required').toBeTruthy();
 const ownerContext=await browser.newContext({baseURL}),peerContext=await browser.newContext({baseURL}),owner=await ownerContext.newPage(),peer=await peerContext.newPage();await observe(owner);await observe(peer);
 const runtimeSha=process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER?runtimeSourceIdentity():undefined;const runtimeChunks=runtimeSha?observeRuntimeChunks(owner):undefined;
 let token:string|undefined,source:string|undefined,target:string|undefined;
 const archive=async(id:string)=>{const b=await(await call(api,token!,'GET',`/whiteboards/${id}`)).json();return b.archived?b:(await call(api,token!,'PATCH',`/whiteboards/${id}`,{archived:true,expectedLifecycleRevision:b.lifecycleRevision})).json();};
 try{
  token=await login(owner);const peerToken=await login(peer,true);source=(await(await call(api,token,'POST','/whiteboards',{requestId:randomUUID(),name:`Durable images ${randomUUID()}`})).json()).id as string;
  await call(api,token,'PUT',`/whiteboards/${source}/members`,{userId:F.leadUserId,role:'editor'});await owner.goto(`/studio/board/${source}`);await expect(owner.getByTestId('collaborative-editor')).toBeVisible();await expect(owner.getByText(/^已同步/)).toBeVisible();
  const png=boardImagePngFixture(),digest=`sha256:${createHash('sha256').update(png).digest('hex')}`;
  const uploaded=owner.waitForResponse(r=>r.url().endsWith(`/whiteboards/${source}/assets`)&&r.request().method()==='POST'),readback=owner.waitForResponse(r=>r.url().includes(`/whiteboards/${source}/assets/`)&&r.url().endsWith('/content'));
  await owner.getByTestId('board-add-image').click();await expect(owner.getByRole('dialog',{name:'添加图片'})).toBeVisible();
  await owner.getByTestId('board-image-input').setInputFiles({name:'durable-evidence.png',mimeType:'image/png',buffer:png});const upload=await uploaded;expect(upload.ok()).toBe(true);const metadata=await upload.json();expect(metadata).toMatchObject({contentDigest:digest,intrinsicWidth:64,intrinsicHeight:48,persistence:'durable',byteSize:png.length});
  const read=await readback;expect(read.status()).toBe(200);expect(read.headers()['cache-control']).toBe('private, no-store');expect(read.request().headers()['authorization']).toBe(`Bearer ${token}`);const persisted=await api.get(`${origin()}/whiteboards/${source}/assets/${metadata.assetId}/content`,{headers:{Authorization:`Bearer ${token}`}});expect(persisted.status()).toBe(200);expect(await persisted.body()).toEqual(png);await painted(owner);
  let snapshot:Awaited<ReturnType<typeof canonical>>|undefined;await expect.poll(async()=>{snapshot=await canonical(api,token!,source!);return JSON.stringify(snapshot.objects);}).toContain(metadata.assetId);
  const canonicalImage=snapshot!.objects.find(object=>object.kind==='image')?.extensionData?.contentObject;expect(canonicalImage).toMatchObject({...metadata,type:'image',status:'ready',sourceUrl:null,failureCode:null});
  expect(JSON.stringify(snapshot!.objects)).toContain('durable');expect(JSON.stringify(snapshot!.objects)).not.toMatch(/blob:|data:image|local-session-/);await info.attach('canonical-upload',{body:JSON.stringify(snapshot),contentType:'application/json'});
  await owner.reload();await painted(owner);const peerRead=peer.waitForResponse(r=>r.url().includes(`/whiteboards/${source}/assets/`)&&r.url().endsWith('/content'));await peer.goto(`/studio/board/${source}`);expect((await peerRead).status()).toBe(200);await painted(peer);
  const peerUrls=await peer.evaluate(()=>(window as unknown as {__images:Evidence}).__images.loaded.map(image=>image.url));expect(peerUrls.length).toBeGreaterThan(0);
  const duplicate=await(await call(api,token,'POST',`/whiteboards/${source}/duplicates`,{requestId:randomUUID(),targetName:`Image copy ${randomUUID()}`,expectedSource:{epoch:snapshot!.board.epoch,seq:snapshot!.board.seq}})).json();target=duplicate.board.id;expect(duplicate.receipt.assetCount).toBe(1);
  await info.attach('pg-independent-pointers',{body:JSON.stringify(await produceImageStorageEvidence(F.orgId,[source,target!],metadata.assetId)),contentType:'application/json'});
  await call(api,token,'DELETE',`/whiteboards/${source}/members/${F.leadUserId}`);// Revoked board membership hides resource existence: read is precisely 404, not 403.
  const denied=await api.get(`${origin()}/whiteboards/${source}/assets/${metadata.assetId}/content`,{headers:{Authorization:`Bearer ${peerToken}`}});expect(denied.status()).toBe(404);expect(await denied.body()).not.toEqual(png);expect(denied.headers()['content-type']).not.toContain('image/');
  const deniedCanonical=await api.post(`${origin()}/whiteboards/${source}/imports/standard-export`,{headers:{Authorization:`Bearer ${peerToken}`},data:{requestId:randomUUID()}});expect(deniedCanonical.status()).toBe(404);expect(await deniedCanonical.text()).not.toContain(metadata.assetId);
  await expect(peer.getByTestId('denied')).toBeVisible();await expect(peer.getByTestId('board-fabric-surface')).toHaveCount(0);
  await expect.poll(()=>peer.evaluate(urls=>urls.every(url=>(window as unknown as {__images:Evidence}).__images.revoked.includes(url)),peerUrls)).toBe(true);
  expect(await peer.evaluate(async urls=>Promise.all(urls.map(async url=>{try{await fetch(url);return false;}catch{return true;}})),peerUrls)).toEqual(peerUrls.map(()=>true));
  const targetBytes=async()=>expect(await(await call(api,token!,'GET',`/whiteboards/${target}/assets/${metadata.assetId}/content`)).body()).toEqual(png);
  const archived=await archive(source);await targetBytes();await call(api,token,'DELETE',`/whiteboards/${source}`,{requestId:randomUUID(),confirmation:'PERMANENTLY_DELETE',expectedLifecycleRevision:archived.lifecycleRevision});source=undefined;
  await targetBytes();await owner.goto(`/studio/board/${target}`);await painted(owner);await owner.reload();await painted(owner);
  await info.attach('pg-target-after-source-delete',{body:JSON.stringify(await produceImageStorageEvidence(F.orgId,[target!],metadata.assetId)),contentType:'application/json'});
 if(runtimeSha&&runtimeChunks)await info.attach('storage-runtime.json',{body:JSON.stringify({scenario:'durable-images',assetId:metadata.assetId,targetBoardId:target,runtimeIdentity:await verifyRuntimeIdentity(api,runtimeSha,await runtimeChunks())}),contentType:'application/json'});
 }finally{await ownerContext.close();await peerContext.close();if(token){if(source)await archive(source);if(target)await archive(target);}}
});

// This is an actual HTTPS/CORS browser fixture, not page.fetch or asset-success mocking.
test('HTTPS image entry rejects real CORS and malformed ranges then retries durable bytes',async({browser,request:api,baseURL},info)=>{
 expect(baseURL).toBeTruthy();
 const {startImageFixture}=await import('../../../scripts/local-session/board-image-https-fixture.mts');
 const png=boardImagePngFixture(),fixture=await startImageFixture(png,new URL(baseURL!).origin);
 const context=await browser.newContext({baseURL,ignoreHTTPSErrors:true}),page=await context.newPage();await observe(page);
 const sha=runtimeSourceIdentity(),chunks=observeRuntimeChunks(page);let token:string|undefined,board:string|undefined;
 const posts:string[]=[],failures:string[]=[];
 page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith(`/whiteboards/${board}/assets`))posts.push(request.url());});
 page.on('requestfailed',request=>{if(request.url()===fixture.url)failures.push(request.failure()?.errorText??'unknown');});
 try{
  token=await login(page);board=(await(await call(api,token,'POST','/whiteboards',{requestId:randomUUID(),name:`HTTPS image acceptance ${randomUUID()}`})).json()).id;
  await page.goto(`/studio/board/${board}`);await expect(page.getByText(/^已同步/)).toBeVisible();
  let expectedObjects=0;
  for(const mode of ['no-cors','malformed-range'] as const){
   fixture.setMode(mode);const beforePosts=posts.length;
   await page.getByRole('button',{name:'图片，快捷键 I'}).click();await expect(page.getByRole('dialog',{name:'添加图片'})).toBeVisible();
   await page.getByLabel('HTTPS 图片地址').fill(fixture.url);await page.getByTestId('board-image-url-apply').click();
   await expect(page.getByTestId('board-image-error')).toHaveText('图片未添加。请检查文件、HTTPS 地址或跨域权限后重试。');
   await expect(page.getByRole('button',{name:'重试',exact:true})).toBeEnabled();
   expect((await canonical(api,token,board!)).objects).toHaveLength(expectedObjects);expect(posts).toHaveLength(beforePosts);
   expect(fixture.receipts.some(receipt=>receipt.mode===mode&&receipt.method==='GET'&&receipt.status===206)).toBe(true);
   if(mode==='no-cors')expect(failures.length).toBeGreaterThan(0);
   await info.attach(`${mode}-visible-error`,{body:await page.screenshot(),contentType:'image/png'});
   fixture.setMode('valid');const uploaded=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`/whiteboards/${board}/assets`));
   await page.getByRole('button',{name:'重试',exact:true}).click();const response=await uploaded;expect(response.ok()).toBe(true);const metadata=await response.json();
   expect(metadata).toMatchObject({persistence:'durable',contentDigest:`sha256:${createHash('sha256').update(png).digest('hex')}`,byteSize:png.length,intrinsicWidth:64,intrinsicHeight:48});
   expectedObjects++;await expect.poll(async()=>(await canonical(api,token!,board!)).objects.length).toBe(expectedObjects);expect(posts).toHaveLength(beforePosts+1);
   const persisted=await call(api,token,'GET',`/whiteboards/${board}/assets/${metadata.assetId}/content`);expect(await persisted.body()).toEqual(png);await painted(page);
   await page.reload();await painted(page);const snapshot=await canonical(api,token,board!);expect(snapshot.objects).toHaveLength(expectedObjects);expect(JSON.stringify(snapshot.objects)).not.toMatch(/blob:|data:image|local-session-/);
  }
  expect(fixture.receipts.filter(receipt=>receipt.method==='GET'&&receipt.mode==='valid').every(receipt=>receipt.origin===new URL(baseURL!).origin&&receipt.range==='bytes=0-26214399')).toBe(true);
  await info.attach('https-range-receipts.json',{body:JSON.stringify({requests:fixture.receipts,browserFailures:failures}),contentType:'application/json'});
  await info.attach('https-image-runtime.json',{body:JSON.stringify(await verifyRuntimeIdentity(api,sha,await chunks())),contentType:'application/json'});
 }finally{
  await context.close();await fixture.close();
  if(token&&board){const current=await(await call(api,token,'GET',`/whiteboards/${board}`)).json();if(!current.archived)await call(api,token,'PATCH',`/whiteboards/${board}`,{archived:true,expectedLifecycleRevision:current.lifecycleRevision});}
 }
});

for(const cancellation of ['close','navigate','revoke'] as const)test(`real completed image upload cannot commit after ${cancellation}`,async({browser,request:api,baseURL},info)=>{
 const ownerContext=await browser.newContext({baseURL}),peerContext=await browser.newContext({baseURL}),owner=await ownerContext.newPage(),peer=await peerContext.newPage();
 await observe(owner);await observe(peer);
 const sha=runtimeSourceIdentity(),chunks=observeRuntimeChunks(peer);let ownerToken:string|undefined,peerToken:string|undefined,board:string|undefined;
 let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});let uploadedResolve!:(metadata:Record<string,unknown>)=>void,uploadedReject!:(error:unknown)=>void;const uploaded=new Promise<Record<string,unknown>>((resolve,reject)=>{uploadedResolve=resolve;uploadedReject=reject;});let finishedResolve!:()=>void;const finished=new Promise<void>(resolve=>{finishedResolve=resolve;});
 try{
  ownerToken=await login(owner);peerToken=await login(peer,true);board=(await(await call(api,ownerToken,'POST','/whiteboards',{requestId:randomUUID(),name:`Image cancellation ${cancellation} ${randomUUID()}`})).json()).id;
  await call(api,ownerToken,'PUT',`/whiteboards/${board}/members`,{userId:F.leadUserId,role:'editor'});await peer.goto(`/studio/board/${board}`);await expect(peer.getByText(/^已同步/)).toBeVisible();
  const initial=(await canonical(api,ownerToken,board!)).objects;expect(initial).toEqual([]);
  // Pass through the real HTTP upload and hold only its actual server response. No invented success.
  await peer.route(`**/whiteboards/${board}/assets`,async route=>{
   try{const response=await route.fetch();expect(response.ok()).toBe(true);uploadedResolve(await response.json());await barrier;try{await route.fulfill({response});}catch{/* Browser legitimately aborted the response after cancellation. */}}
   catch(error){uploadedReject(error);}
   finally{finishedResolve();}
  });
  await peer.getByRole('button',{name:'图片，快捷键 I'}).click();await expect(peer.getByRole('dialog',{name:'添加图片'})).toBeVisible();await peer.getByLabel('上传图片').setInputFiles({name:'actual-delayed.png',mimeType:'image/png',buffer:boardImagePngFixture()});
  const actualMetadata=await uploaded;expect(actualMetadata).toMatchObject({persistence:'durable',byteSize:boardImagePngFixture().length});
  if(cancellation==='close')await peer.getByTestId('board-image-close').click();
  else if(cancellation==='navigate')await peer.goto('/home');
  else{await call(api,ownerToken,'DELETE',`/whiteboards/${board}/members/${F.leadUserId}`);await expect(peer.getByTestId('denied')).toBeVisible();}
  release();await finished;
  // This server asset really exists; abort does not promise its deletion. Canonical mutation is forbidden.
  const actualAsset=await call(api,ownerToken,'GET',`/whiteboards/${board}/assets/${actualMetadata.assetId}/content`);expect(await actualAsset.body()).toEqual(boardImagePngFixture());
  expect((await canonical(api,ownerToken,board!)).objects).toEqual(initial);
  if(cancellation==='revoke'){
   const denied=await api.get(`${origin()}/whiteboards/${board}/assets/${actualMetadata.assetId}/content`,{headers:{Authorization:`Bearer ${peerToken}`}});expect(denied.status()).toBe(404);expect(denied.headers()['content-type']).not.toContain('image/');
   const deniedUpload=await api.post(`${origin()}/whiteboards/${board}/assets`,{headers:{Authorization:`Bearer ${peerToken}`},multipart:{file:{name:'denied.png',mimeType:'image/png',buffer:boardImagePngFixture()}}});expect(deniedUpload.status()).toBe(404);
  }
  await owner.goto(`/studio/board/${board}`);await expect(owner.getByText(/^已同步/)).toBeVisible();await owner.reload();await expect(owner.getByText(/^已同步/)).toBeVisible();expect((await canonical(api,ownerToken,board!)).objects).toEqual(initial);
  await info.attach(`image-${cancellation}-server-orphan.json`,{body:JSON.stringify({boardId:board,asset:actualMetadata,canonicalObjects:initial,serverAssetStillPresent:true,cleanup:'owned board archived in finally; no claim that client abort deletes durable asset'}),contentType:'application/json'});
  // A fresh authorized scope must still accept the actual bytes after the cancelled result.
  const fresh=cancellation==='revoke'?owner:peer;
  if(cancellation==='navigate')await peer.goto(`/studio/board/${board}`);
  await fresh.getByRole('button',{name:'图片，快捷键 I'}).click();await expect(fresh.getByRole('dialog',{name:'添加图片'})).toBeVisible();
  const freshUpload=fresh.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`/whiteboards/${board}/assets`));
  await fresh.getByLabel('上传图片').setInputFiles({name:'fresh-authorized.png',mimeType:'image/png',buffer:boardImagePngFixture()});expect((await freshUpload).ok()).toBe(true);
  await expect.poll(async()=>(await canonical(api,ownerToken!,board!)).objects.length).toBe(1);await painted(fresh);
  await info.attach(`image-${cancellation}-runtime.json`,{body:JSON.stringify(await verifyRuntimeIdentity(api,sha,await chunks())),contentType:'application/json'});
 }finally{
  release();await ownerContext.close();await peerContext.close();
  if(ownerToken&&board){const current=await(await call(api,ownerToken,'GET',`/whiteboards/${board}`)).json();if(!current.archived)await call(api,ownerToken,'PATCH',`/whiteboards/${board}`,{archived:true,expectedLifecycleRevision:current.lifecycleRevision});}
 }
});
