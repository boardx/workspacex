import {test,expect} from '@playwright/test';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {boardLogin,canonicalBoardSnapshot,createAcceptanceBoard,object,createCommands,operate} from './board-acceptance-support';
import {runtimeSourceIdentity,observeRuntimeChunks,verifyRuntimeIdentity} from './board-runtime-evidence';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';

test('real canvas sticky and rectangle Tab continue/select; Delete and each undo persist atomically',async({page,request:api},info)=>{
 // Both widget kinds execute independent durable history and reload journeys.
 // CI trace reached the second native Tab at 29.954s; match the standalone
 // formal lane's budget without changing action or assertion timeouts.
 test.setTimeout(180_000);
 const sourceSha=runtimeSourceIdentity(),chunks=observeRuntimeChunks(page);
 const token=await boardLogin(page),owned:Array<{id:string;title:string}>=[];let failure:unknown;
 const synced=async()=>{await expect(page.getByTestId('board-sync-status')).toHaveAttribute('data-sync-phase','synced');};
 try{
  for(const kind of ['sticky','rectangle'] as const){
   const title=`Keyboard ${kind} ${info.project.name}`,id=await createAcceptanceBoard(api,token,title);owned.push({id,title});
   const source=object(`keyboard-${kind}`,kind,100,220,'',80,70);await operate(api,token,id,createCommands([source]));
   await page.goto(`/studio/board/${id}`);await synced();const runtimeProof=await verifyRuntimeIdentity(api,sourceSha,await chunks());await info.attach(`${kind}-runtime-before`,{body:JSON.stringify(runtimeProof,null,2),contentType:'application/json'});const before=await canonicalBoardSnapshot(api,token,id),surface=page.getByTestId('board-fabric-surface');
   const box=await surface.boundingBox();expect(box).not.toBeNull();const zoom=Number(await surface.getAttribute('data-viewport-zoom')),panX=Number(await surface.getAttribute('data-viewport-pan-x')),panY=Number(await surface.getAttribute('data-viewport-pan-y'));
   const point={x:box!.x+panX+140*zoom,y:box!.y+panY+255*zoom};
   expect(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS',point)).toBe(true);await page.mouse.click(point.x,point.y);
   await expect(page.getByTestId(`board-a11y-object-${source.id}`)).toHaveAttribute('aria-pressed','true');await expect(surface).toBeFocused();await page.keyboard.press('Tab');
   await expect.poll(async()=> (await canonicalBoardSnapshot(api,token,id)).objects.length).toBe(3);await synced();const continued=await canonicalBoardSnapshot(api,token,id),next=continued.objects.find(value=>value.id!==source.id&&value.kind===kind)!;
   expect(next).toBeTruthy();expect(next.style).toEqual(before.objects[0]!.style);expect(continued.revision).toEqual({epoch:before.revision.epoch,seq:before.revision.seq+1});
   expect(continued.objects.find(value=>value.kind==='connector')!.connector).toMatchObject({from:source.id,to:next.id});await expect(page.getByTestId(`board-a11y-object-${next.id}`)).toHaveAttribute('aria-pressed','true');
   await page.keyboard.press('Delete');await expect.poll(async()=> (await canonicalBoardSnapshot(api,token,id)).objects.map(value=>value.id)).toEqual([source.id]);await synced();
   const deleted=await canonicalBoardSnapshot(api,token,id);expect(deleted.revision).toEqual({epoch:continued.revision.epoch,seq:continued.revision.seq+1});
   await page.keyboard.press('ControlOrMeta+z');await expect.poll(async()=> (await canonicalBoardSnapshot(api,token,id)).objects).toEqual(continued.objects);await synced();
   const restored=await canonicalBoardSnapshot(api,token,id);expect(restored.revision).toEqual({epoch:deleted.revision.epoch,seq:deleted.revision.seq+1});
   await page.keyboard.press('ControlOrMeta+z');await expect.poll(async()=> (await canonicalBoardSnapshot(api,token,id)).objects).toEqual(before.objects);await synced();
   const undone=await canonicalBoardSnapshot(api,token,id);expect(undone.revision).toEqual({epoch:restored.revision.epoch,seq:restored.revision.seq+1});
   await page.keyboard.press('ControlOrMeta+Shift+z');await expect.poll(async()=> (await canonicalBoardSnapshot(api,token,id)).objects.length).toBe(3);await synced();
   const redone=await canonicalBoardSnapshot(api,token,id),edge=continued.objects.find(value=>value.kind==='connector')!;
   const restoredWidget=redone.objects.find(value=>value.restoredFrom===next.id)!;
   const restoredEdge=redone.objects.find(value=>value.restoredFrom===edge.id)!;
   expect(restoredWidget).toBeTruthy();expect(restoredEdge).toBeTruthy();
   expect(redone.revision).toEqual({epoch:undone.revision.epoch,seq:undone.revision.seq+1});
   expect(new Set(redone.objects.map(value=>value.id)).size).toBe(3);
   expect(redone.objects.some(value=>value.id===next.id||value.id===edge.id)).toBe(false);
   expect(restoredWidget).toEqual({...next,id:restoredWidget.id,restoredFrom:next.id});
   expect(restoredEdge).toEqual({...edge,id:restoredEdge.id,restoredFrom:edge.id,connector:{...edge.connector,to:restoredWidget.id}});
   expect(redone.objects.find(value=>value.id===source.id)).toEqual(before.objects[0]);
   await page.reload();await synced();expect((await canonicalBoardSnapshot(api,token,id)).objects).toEqual(redone.objects);
   // Reload resets local history. The remaining input-scope checks must preserve this exact snapshot.
   // An actual product text input retains Delete/Tab instead of deleting/continuing the selected widget.
   await surface.focus();await page.keyboard.press('ControlOrMeta+a');
   await expect(page.getByTestId('board-a11y-selection-announcement')).toHaveText('已选择 3 个对象');
   // The inline board title is intentionally readonly. Use the actual uncommitted
   // bulk draft input so native Delete/Tab can be checked without changing data.
   await page.keyboard.press('Shift+N');const input=page.getByTestId('board-bulk-text');
   await expect(input).toBeEditable();await input.fill(`${title}X`);
   await input.press('ControlOrMeta+a');await input.press('ArrowLeft');await input.press('Delete');
   await expect(input).toHaveValue(`${title.slice(1)}X`);await input.fill(title);await input.press('Tab');
   await expect(input).not.toBeFocused();
   expect(await canonicalBoardSnapshot(api,token,id)).toEqual(redone);
   await page.getByRole('button',{name:'取消',exact:true}).click();
   await expect(page.getByRole('dialog',{name:'批量创建便利贴'})).toHaveCount(0);
   expect(await canonicalBoardSnapshot(api,token,id)).toEqual(redone);
   await page.screenshot({path:info.outputPath(`${kind}-keyboard.png`)});
   await info.attach(`${kind}-runtime-after`,{body:JSON.stringify(await verifyRuntimeIdentity(api,sourceSha,await chunks()),null,2),contentType:'application/json'});
  }
 }catch(error){failure=error;}
 finally{const errors:unknown[]=[];for(const board of owned){try{await deleteOwnedConnectorFixture(api,token,board.id,F.userId,board.title);}catch(error){errors.push(error);}}if(errors.length)failure=new AggregateError([...(failure?[failure]:[]),...errors],'Keyboard execution/cleanup failures');}
 if(failure)throw failure;
});
