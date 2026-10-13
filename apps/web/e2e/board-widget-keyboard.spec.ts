import {test,expect} from '@playwright/test';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {boardLogin,canonicalBoardSnapshot,createAcceptanceBoard,object,createCommands,operate} from './board-acceptance-support';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';

test('real canvas sticky and rectangle Tab continue/select; Delete and each undo persist atomically',async({page,request:api},info)=>{
 const token=await boardLogin(page),owned:Array<{id:string;title:string}>=[];let failure:unknown;
 const synced=async()=>{await expect(page.getByTestId('board-sync-status')).toHaveAttribute('data-sync-phase','synced');};
 try{
  for(const kind of ['sticky','rectangle'] as const){
   const title=`Keyboard ${kind} ${info.project.name}`,id=await createAcceptanceBoard(api,token,title);owned.push({id,title});
   const source=object(`keyboard-${kind}`,kind,100,220,'',80,70);await operate(api,token,id,createCommands([source]));
   await page.goto(`/studio/board/${id}`);await synced();const before=await canonicalBoardSnapshot(api,token,id),surface=page.getByTestId('board-fabric-surface');
   const box=await surface.boundingBox();expect(box).not.toBeNull();const zoom=Number(await surface.getAttribute('data-viewport-zoom')),panX=Number(await surface.getAttribute('data-viewport-pan-x')),panY=Number(await surface.getAttribute('data-viewport-pan-y'));
   const point={x:box!.x+panX+140*zoom,y:box!.y+panY+255*zoom};
   expect(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS',point)).toBe(true);await page.mouse.click(point.x,point.y);
   await expect(page.getByTestId(`board-a11y-object-${source.id}`)).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Tab');
   await expect.poll(async()=> (await canonicalBoardSnapshot(api,token,id)).objects.length).toBe(3);await synced();const continued=await canonicalBoardSnapshot(api,token,id),next=continued.objects.find(value=>value.id!==source.id&&value.kind===kind)!;
   expect(next).toBeTruthy();expect(next.style).toEqual(before.objects[0]!.style);expect(continued.revision).toEqual({epoch:before.revision.epoch,seq:before.revision.seq+1});
   expect(continued.objects.find(value=>value.kind==='connector')!.connector).toMatchObject({from:source.id,to:next.id});await expect(page.getByTestId(`board-a11y-object-${next.id}`)).toHaveAttribute('aria-pressed','true');
   await page.keyboard.press('Delete');await expect.poll(async()=> (await canonicalBoardSnapshot(api,token,id)).objects.map(value=>value.id)).toEqual([source.id]);await synced();
   await page.keyboard.press('ControlOrMeta+z');await expect.poll(async()=> (await canonicalBoardSnapshot(api,token,id)).objects).toEqual(continued.objects);await synced();
   await page.keyboard.press('ControlOrMeta+z');await expect.poll(async()=> (await canonicalBoardSnapshot(api,token,id)).objects).toEqual(before.objects);await synced();
   await page.reload();await synced();expect((await canonicalBoardSnapshot(api,token,id)).objects).toEqual(before.objects);
   // An actual product text input retains Delete/Tab instead of deleting/continuing the selected widget.
   await surface.focus();await page.keyboard.press('ControlOrMeta+a');await page.getByTestId('board-title-menu').click();const input=page.getByLabel('白板名称');await input.fill(`${title}X`);await input.press('Home');await input.press('Delete');await expect(input).toHaveValue(`${title.slice(1)}X`);await input.fill(title);await input.press('Tab');
   expect((await canonicalBoardSnapshot(api,token,id)).objects).toEqual(before.objects);await page.keyboard.press('Escape');
   await page.screenshot({path:info.outputPath(`${kind}-keyboard.png`)});
  }
 }catch(error){failure=error;}
 finally{const errors:unknown[]=[];for(const board of owned){try{await deleteOwnedConnectorFixture(api,token,board.id,F.userId,board.title);}catch(error){errors.push(error);}}if(errors.length)failure=new AggregateError([...(failure?[failure]:[]),...errors],'Keyboard execution/cleanup failures');}
 if(failure)throw failure;
});
