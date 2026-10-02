import {observeRuntimeChunks,runtimeSourceIdentity,verifyRuntimeIdentity} from './board-runtime-evidence';
import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { FULLSTACK_E2E as F } from './fullstack-smoke-fixture';
import { produceImageStorageEvidence } from './support/board-durable-images-storage';
import {boardImagePngFixture} from './support/board-image-fixture';
import {origin,call,login,canonical,observe,painted,type Evidence} from './support/board-image-browser-support';
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
