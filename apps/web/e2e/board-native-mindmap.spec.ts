import { test, expect, type Page } from '@playwright/test';
import { FULLSTACK_E2E as F } from './fullstack-smoke-fixture';
import { boardLogin, boardApi, canonicalBoardSnapshot, createAcceptanceBoard } from './board-acceptance-support';
import { runtimeSourceIdentity, observeRuntimeChunks, verifyRuntimeIdentity } from './board-runtime-evidence';
import { deleteOwnedConnectorFixture } from './support/connector-acceptance-fixture';
import { expectBoardSynced } from './support/board-sync-status';

test('native mindmap root child sibling collapse reparent undo redo source and peer refresh',async({page,browser,request:api},info)=>{
  test.setTimeout(240_000);
  const source=runtimeSourceIdentity(),chunks=observeRuntimeChunks(page);
  const token=await boardLogin(page),title=`Native mindmap ${info.project.name}`,id=await createAcceptanceBoard(api,token,title);
  const peerContext=await browser.newContext({viewport:{width:1440,height:900}}),peer=await peerContext.newPage();
  let firstError:unknown;const cleanupErrors:unknown[]=[];
  const synced=async(target:Page)=>expectBoardSynced(target,30_000);
  const snapshot=()=>canonicalBoardSnapshot(api,token,id);
  const selectCanvas=async(target:Page,objectId:string)=>{
    const state=await snapshot(),object=state.objects.find(object=>object.id===objectId)!;
    const surface=target.getByTestId('board-fabric-surface'),bounds=await surface.boundingBox();expect(bounds).not.toBeNull();
    const zoom=Number(await surface.getAttribute('data-viewport-zoom')),panX=Number(await surface.getAttribute('data-viewport-pan-x')),panY=Number(await surface.getAttribute('data-viewport-pan-y'));
    const x=bounds!.x+panX+(object.geometry.x+object.geometry.width/2)*zoom,y=bounds!.y+panY+(object.geometry.y+object.geometry.height/2)*zoom;
    expect(await target.evaluate(({x,y})=>document.elementFromPoint(x,y)?.tagName==='CANVAS',{x,y})).toBe(true);
    await target.mouse.click(x,y);await expect(target.getByTestId(`board-a11y-object-${objectId}`)).toHaveAttribute('aria-pressed','true');await surface.focus();
  };
  const menu=async()=>{const child=page.getByTestId('board-mindmap-create-root');if(!await child.isVisible())await page.getByTestId('board-mindmap-menu').click();await expect(child).toBeVisible({timeout:5000});};
  try{
    await boardApi(api,token,'PUT',`/whiteboards/${id}/members`,{userId:F.adminUserId,role:'editor'});
    await page.setViewportSize({width:1440,height:900});await page.goto(`/studio/board/${id}`);await synced(page);
    const before=await snapshot();await menu();await page.getByTestId('board-mindmap-create-root').click();
    await expect.poll(async()=>(await snapshot()).objects.length).toBe(1);await synced(page);
    const rootState=await snapshot(),root=rootState.objects[0]!;
    expect(rootState.revision.seq).toBe(before.revision.seq+1);expect(root.extensionData?.mindmap).toEqual({version:1,role:'node',treeId:root.id,collapsed:false});
    await selectCanvas(page,root.id);await page.keyboard.press('Tab');await expect.poll(async()=>(await snapshot()).objects.length).toBe(3);await synced(page);
    const childState=await snapshot(),child=childState.objects.find(object=>object.kind==='sticky'&&object.id!==root.id)!;
    expect(childState.revision.seq).toBe(rootState.revision.seq+1);await expect(page.getByTestId(`board-a11y-object-${child.id}`)).toHaveAttribute('aria-pressed','true');
    await page.getByTestId('board-fabric-surface').focus();await page.keyboard.press('Enter');await expect.poll(async()=>(await snapshot()).objects.length).toBe(5);await synced(page);
    const siblingState=await snapshot(),sibling=siblingState.objects.find(object=>object.kind==='sticky'&&object.id!==root.id&&object.id!==child.id)!;
    expect(siblingState.revision.seq).toBe(childState.revision.seq+1);
    // Ordinary multi-delete and duplicate must fail before a raw Yjs write.
    await page.getByTestId('board-fabric-surface').focus();await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');await expect(page.getByText(/选择或区域包含思维导图/)).toBeVisible();
    expect(await snapshot()).toEqual(siblingState);await synced(page);
    await page.keyboard.press('ControlOrMeta+d');await expect(page.getByText(/暂不支持复制思维导图/)).toBeVisible();
    expect(await snapshot()).toEqual(siblingState);await page.reload();await synced(page);
    expect(await snapshot()).toEqual(siblingState);await expect(page.getByTestId('board-a11y-mirror').getByRole('button')).toHaveCount(5);
    const peerToken=await boardLogin(peer,F.adminEmail,F.adminPassword);expect(peerToken).toBeTruthy();await peer.goto(`/studio/board/${id}`);await synced(peer);await expect(peer.getByTestId('board-a11y-mirror').getByRole('button')).toHaveCount(5);
    await selectCanvas(page,root.id);await menu();await page.getByTestId('board-mindmap-collapse').click();await expect.poll(async()=>{const object=(await snapshot()).objects.find(object=>object.id===root.id)!;return(object.extensionData?.mindmap as{collapsed:boolean}).collapsed;}).toBe(true);await synced(page);
    const collapsed=await snapshot();expect(collapsed.objects).toHaveLength(5);await expect(page.getByTestId('board-a11y-mirror').getByRole('button')).toHaveCount(1);await expect(peer.getByTestId('board-a11y-mirror').getByRole('button')).toHaveCount(1);
    await page.reload();await synced(page);await expect(page.getByTestId('board-a11y-mirror').getByRole('button')).toHaveCount(1);
    await selectCanvas(page,root.id);await menu();await page.getByTestId('board-mindmap-export').click();const sourceText=await page.getByTestId('board-mindmap-source').inputValue();expect(sourceText).toContain('中心主题');expect(sourceText.match(/新主题/g)).toHaveLength(2);expect(sourceText).not.toMatch(/geometry|width|height|rotation/);await page.keyboard.press('Escape');
    await menu();await page.getByTestId('board-mindmap-collapse').click();await expect(page.getByTestId('board-a11y-mirror').getByRole('button')).toHaveCount(5);await synced(page);
    await test.step('打开父菜单内的重挂目标列表并保存父关系',async()=>{
      await selectCanvas(page,child.id);await menu();
      const toggle=page.getByTestId('board-mindmap-reparent-toggle');await expect(toggle).toBeVisible({timeout:5000});await toggle.click();
      await expect(page.getByTestId('board-mindmap-reparent-targets')).toBeVisible({timeout:5000});
      await expect(page.getByTestId('board-mindmap-create-root')).toBeVisible();
      const target=page.getByTestId(`board-mindmap-reparent-${sibling.id}`);await expect(target).toBeVisible({timeout:5000});await expect(target).toBeEnabled();await target.click({timeout:5000});
      await expect.poll(async()=> (await snapshot()).objects.find(object=>object.connector?.to===child.id)!.connector!.from).toBe(sibling.id);await synced(page);
    });
    const reparented=await snapshot();expect(reparented.objects.map(object=>object.id).sort()).toEqual(siblingState.objects.map(object=>object.id).sort());
    await test.step('保存后的立即撤销和重做保持原对象身份并走权威历史接口',async()=>{
      const undoResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/undo')&&response.request().method()==='POST');
      await page.getByTestId('board-fabric-surface').focus();await page.keyboard.press('ControlOrMeta+z');expect((await undoResponse).status()).toBe(201);
      await expect.poll(async()=> (await snapshot()).objects.find(object=>object.connector?.to===child.id)!.connector!.from).toBe(root.id);await synced(page);
      expect((await snapshot()).objects.map(object=>object.id).sort()).toEqual(reparented.objects.map(object=>object.id).sort());
      const redoResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/undo')&&response.request().method()==='POST');
      await page.keyboard.press('ControlOrMeta+Shift+z');expect((await redoResponse).status()).toBe(201);
      await expect.poll(async()=> (await snapshot()).objects.find(object=>object.connector?.to===child.id)!.connector!.from).toBe(sibling.id);await synced(page);
      expect((await snapshot()).objects.map(object=>object.id).sort()).toEqual(reparented.objects.map(object=>object.id).sort());
    });await peer.reload();await synced(peer);await expect(peer.getByTestId('board-a11y-mirror').getByRole('button')).toHaveCount(5);
    await page.screenshot({path:info.outputPath('native-mindmap.png'),fullPage:true});await info.attach('runtime-source',{body:JSON.stringify(await verifyRuntimeIdentity(api,source,await chunks()),null,2),contentType:'application/json'});
    // Import the actual exported source through the real Mermaid parser/dialog.
    await menu();await page.getByTestId('board-mindmap-import').click();await page.getByTestId('board-mindmap-import-source').fill(sourceText);await page.getByTestId('board-mindmap-import-apply').click();await expect.poll(async()=>(await snapshot()).objects.length).toBe(10);await synced(page);
    const imported=await snapshot();expect(imported.objects.filter(object=>object.kind==='sticky'&&(object.extensionData?.mindmap as{treeId:string})?.treeId!==root.id)).toHaveLength(3);
    // Delete the imported root through the server-authoritative subtree command.
    const importedRoot=imported.objects.find(object=>object.kind==='sticky'&&(object.extensionData?.mindmap as{treeId:string})?.treeId===object.id&&object.id!==root.id)!;
    expect(imported.objects.find(object=>object.id===root.id)!.geometry).toEqual(reparented.objects.find(object=>object.id===root.id)!.geometry);
    for(const old of reparented.objects.filter(object=>object.kind==='sticky'))expect(importedRoot.geometry.y).toBeGreaterThan(old.geometry.y+old.geometry.height);
    // The product reveals the new root after its authoritative revision arrives.
    await expect(page.getByTestId(`board-a11y-object-${importedRoot.id}`)).toHaveAttribute('aria-pressed','true');
    await selectCanvas(page,importedRoot.id);await page.getByTestId('board-fabric-surface').focus();await page.keyboard.press('Delete');await expect.poll(async()=>(await snapshot()).objects.length).toBe(5);await synced(page);
  }catch(error){firstError=error;}
  finally{try{await peerContext.close();}catch(error){cleanupErrors.push(error);}try{await deleteOwnedConnectorFixture(api,token,id,F.userId,title);}catch(error){cleanupErrors.push(error);}if(cleanupErrors.length)await info.attach('cleanup-errors',{body:cleanupErrors.map(error=>String(error)).join('\n'),contentType:'text/plain'});}
  if(firstError)throw firstError;if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'Mindmap owned fixture cleanup failed');
});
