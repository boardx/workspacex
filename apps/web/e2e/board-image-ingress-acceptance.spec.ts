import {assertImageIngressProofs,type ImageIngressProof} from './support/board-image-ingress-proof';
import {createHash,randomUUID} from 'node:crypto';
import {expect,test} from '@playwright/test';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {boardImagePngFixture} from './support/board-image-fixture';
import {observeRuntimeChunks,runtimeSourceIdentity,verifyRuntimeIdentity} from './board-runtime-evidence';
import {origin,call,login,canonical,observe,painted} from './support/board-image-browser-support';

const proofs:ImageIngressProof[]=[];
test.afterAll(()=>{assertImageIngressProofs(proofs,runtimeSourceIdentity());});

// This is an actual HTTPS/CORS browser fixture, not page.fetch or asset-success mocking.
test('HTTPS image entry rejects real CORS and malformed ranges then retries durable bytes',async({browser,request:api,baseURL},info)=>{
 expect(baseURL).toBeTruthy();
 const {startImageFixture}=await import('../../../scripts/local-session/board-image-https-fixture.mts');
 const png=boardImagePngFixture(),fixture=await startImageFixture(png,new URL(baseURL!).origin);
 // Trust is confined to this owned certificate fixture context: all other HTTPS is denied.
 // The application/API are the existing HTTP loopback stack. This does not test public TLS trust.
 const context=await browser.newContext({baseURL,ignoreHTTPSErrors:true});
 const fixtureOrigin=new URL(fixture.url).origin,blockedHttps:string[]=[];
 await context.route(/^https:\/\//,async route=>{
  if(new URL(route.request().url()).origin===fixtureOrigin)await route.continue();
  else{blockedHttps.push(route.request().url());await route.abort('blockedbyclient');}
 });
 const page=await context.newPage();await observe(page);
 const sha=runtimeSourceIdentity(),chunks=observeRuntimeChunks(page);let token:string|undefined,board:string|undefined;
 const posts:string[]=[],failures:string[]=[];
 page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith(`/whiteboards/${board}/assets`))posts.push(request.url());});
 page.on('requestfailed',request=>{if(request.url()===fixture.url)failures.push(request.failure()?.errorText??'unknown');});
 try{
  token=await login(page);board=(await(await call(api,token,'POST','/whiteboards',{requestId:randomUUID(),name:`HTTPS image acceptance ${randomUUID()}`})).json()).id;
  await page.goto(`/studio/board/${board}`);await expect(page.getByText(/^已同步/)).toBeVisible();
  const before=(await canonical(api,token,board!)).objects;expect(before).toEqual([]);
  let expectedObjects=0,persistedBytes:Buffer|undefined;
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
   const persisted=await call(api,token,'GET',`/whiteboards/${board}/assets/${metadata.assetId}/content`);persistedBytes=await persisted.body();expect(persistedBytes).toEqual(png);await painted(page);
   await page.reload();await painted(page);const snapshot=await canonical(api,token,board!);expect(snapshot.objects).toHaveLength(expectedObjects);expect(JSON.stringify(snapshot.objects)).not.toMatch(/blob:|data:image|local-session-/);
  }
  expect(fixture.receipts.filter(receipt=>receipt.method==='GET'&&receipt.mode==='valid').every(receipt=>receipt.origin===new URL(baseURL!).origin&&receipt.range==='bytes=0-26214399')).toBe(true);
  expect(blockedHttps).toEqual([]);expect(fixture.certificateSha256).toMatch(/^[a-f0-9]{64}$/);
  await info.attach('https-range-receipts.json',{body:JSON.stringify({fixtureOrigin,certificateSha256:fixture.certificateSha256,blockedHttps,requests:fixture.receipts,browserFailures:failures}),contentType:'application/json'});
  const runtime=await verifyRuntimeIdentity(api,sha,await chunks());
  proofs.push({group:'https',runtime,png,persisted:persistedBytes!,canonicalBefore:before,canonicalAfter:(await canonical(api,token,board!)).objects,https:{certificateSha256:fixture.certificateSha256,blockedHttps,browserFailures:failures,requests:fixture.receipts}});
  await info.attach('image-ingress-raw-proof.json',{body:JSON.stringify(proofs.at(-1)),contentType:'application/json'});
  await info.attach('https-image-runtime.json',{body:JSON.stringify(runtime),contentType:'application/json'});
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
  const actualAsset=await call(api,ownerToken,'GET',`/whiteboards/${board}/assets/${actualMetadata.assetId}/content`);const persistedBytes=await actualAsset.body();expect(persistedBytes).toEqual(boardImagePngFixture());
  expect((await canonical(api,ownerToken,board!)).objects).toEqual(initial);
  const deniedStatuses:number[]=[];
  if(cancellation==='revoke'){
   const denied=await api.get(`${origin()}/whiteboards/${board}/assets/${actualMetadata.assetId}/content`,{headers:{Authorization:`Bearer ${peerToken}`}});deniedStatuses.push(denied.status());expect(denied.status()).toBe(404);expect(denied.headers()['content-type']).not.toContain('image/');
   const deniedUpload=await api.post(`${origin()}/whiteboards/${board}/assets`,{headers:{Authorization:`Bearer ${peerToken}`},multipart:{file:{name:'denied.png',mimeType:'image/png',buffer:boardImagePngFixture()}}});deniedStatuses.push(deniedUpload.status());expect(deniedUpload.status()).toBe(404);
  }
  await owner.goto(`/studio/board/${board}`);await expect(owner.getByText(/^已同步/)).toBeVisible();await owner.reload();await expect(owner.getByText(/^已同步/)).toBeVisible();expect((await canonical(api,ownerToken,board!)).objects).toEqual(initial);
  const afterCancellation=(await canonical(api,ownerToken,board!)).objects;expect(afterCancellation).toEqual(initial);
  await info.attach(`image-${cancellation}-server-orphan.json`,{body:JSON.stringify({boardId:board,asset:actualMetadata,canonicalObjects:initial,serverAssetStillPresent:true,cleanup:'owned board archived in finally; no claim that client abort deletes durable asset'}),contentType:'application/json'});
  // A fresh authorized scope must still accept the actual bytes after the cancelled result.
  const fresh=cancellation==='revoke'?owner:peer;
  if(cancellation==='navigate')await peer.goto(`/studio/board/${board}`);
  await fresh.getByRole('button',{name:'图片，快捷键 I'}).click();await expect(fresh.getByRole('dialog',{name:'添加图片'})).toBeVisible();
  const freshUpload=fresh.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(`/whiteboards/${board}/assets`));
  await fresh.getByLabel('上传图片').setInputFiles({name:'fresh-authorized.png',mimeType:'image/png',buffer:boardImagePngFixture()});expect((await freshUpload).ok()).toBe(true);
  await expect.poll(async()=>(await canonical(api,ownerToken!,board!)).objects.length).toBe(1);await painted(fresh);
  const runtime=await verifyRuntimeIdentity(api,sha,await chunks());
  proofs.push({group:cancellation,runtime,png:boardImagePngFixture(),persisted:persistedBytes,canonicalBefore:initial,canonicalAfter:afterCancellation,...(cancellation==='revoke'?{deniedStatuses}:{})});
  await info.attach('image-ingress-raw-proof.json',{body:JSON.stringify(proofs.at(-1)),contentType:'application/json'});
  await info.attach(`image-${cancellation}-runtime.json`,{body:JSON.stringify(runtime),contentType:'application/json'});
 }finally{
  release();await ownerContext.close();await peerContext.close();
  if(ownerToken&&board){const current=await(await call(api,ownerToken,'GET',`/whiteboards/${board}`)).json();if(!current.archived)await call(api,ownerToken,'PATCH',`/whiteboards/${board}`,{archived:true,expectedLifecycleRevision:current.lifecycleRevision});}
 }
});
