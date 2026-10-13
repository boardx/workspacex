import {createHash,randomUUID} from 'node:crypto';
import {test,expect} from '@playwright/test';
import {boardImagePngFixture} from './support/board-image-fixture';
import {origin,call,login,canonical} from './support/board-image-browser-support';
import {expectBoardSynced} from './support/board-sync-status';

test('multiple image files preserve successful tiles and only retry a failed upload with exact bytes after refresh',async({page,request:api},info)=>{
 test.setTimeout(120_000);
 let token='',boardId='',failure:unknown;
 try{
  token=await login(page);
  boardId=(await(await call(api,token,'POST','/whiteboards',{requestId:randomUUID(),name:`Multi image ${randomUUID()}`})).json()).id;
  await page.goto(`/studio/board/${boardId}`);await expectBoardSynced(page);
  const png=boardImagePngFixture(),digest=`sha256:${createHash('sha256').update(png).digest('hex')}`;
  let attempts=0;
  await page.route(`**/whiteboards/${boardId}/assets`,async route=>{
   if(route.request().method()==='POST'&&++attempts===2){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'temporary image upload unavailable'})});return;}
   await route.continue();
  });
  await page.getByTestId('board-add-image').click();
  const dialog=page.getByRole('dialog',{name:'添加图片',exact:true});
  await page.getByTestId('board-image-input').setInputFiles(['first.png','failed.png','third.png'].map(name=>({name,mimeType:'image/png',buffer:png})));
  const retry=dialog.getByRole('button',{name:'仅重试失败图片',exact:true});await expect(retry).toBeEnabled();await expectBoardSynced(page);
  const images=(snapshot:Awaited<ReturnType<typeof canonical>>)=>snapshot.objects.filter(object=>object.kind==='image');
  const first=images(await canonical(api,token,boardId));expect(first).toHaveLength(2);
  expect(first.map(object=>object.extensionData?.contentObject?.fileName).sort()).toEqual(['first.png','third.png']);expect(attempts).toBe(3);
  await retry.click();await expect(dialog).toBeHidden();await expectBoardSynced(page);
  const complete=images(await canonical(api,token,boardId));expect(complete).toHaveLength(3);expect(attempts).toBe(4);
  expect(new Set(complete.map(object=>object.id)).size).toBe(3);
  for(const retained of first)expect(complete.find(object=>object.id===retained.id)).toEqual(retained);
  expect(complete.map(object=>object.extensionData?.contentObject?.fileName).sort()).toEqual(['failed.png','first.png','third.png']);
  expect(new Set(complete.map(object=>`${object.geometry.x}:${object.geometry.y}`)).size).toBe(3);
  for(const object of complete){
   const content=object.extensionData?.contentObject;expect(content).toMatchObject({type:'image',status:'ready',contentDigest:digest,byteSize:png.length});
   const response=await api.get(`${origin()}/whiteboards/${boardId}/assets/${content!.assetId}/content`,{headers:{authorization:`Bearer ${token}`}});
   expect(response.status()).toBe(200);expect(await response.body()).toEqual(png);
  }
  await page.reload();await expectBoardSynced(page);expect(images(await canonical(api,token,boardId))).toEqual(complete);
  await info.attach('multi-image-safe-receipt',{body:JSON.stringify({count:complete.length,uploadAttempts:attempts,contentDigest:digest,byteSize:png.length}),contentType:'application/json'});
 }catch(error){failure=error;throw error;}finally{
  if(boardId&&token)try{const board=await(await call(api,token,'GET',`/whiteboards/${boardId}`)).json();if(!board.archived)await call(api,token,'PATCH',`/whiteboards/${boardId}`,{archived:true,expectedLifecycleRevision:board.lifecycleRevision});}catch(error){if(!failure)throw error;await info.attach('multi-image-cleanup-failure',{body:'Owned board cleanup failed after primary failure',contentType:'text/plain'});}
 }
});
