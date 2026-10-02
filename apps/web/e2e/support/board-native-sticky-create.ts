import {expect,type Page,type APIRequestContext} from '@playwright/test';
import {canonicalRows,canonicalBoardSnapshot,boardHead} from '../board-acceptance-support';
import {expectBoardSynced} from './board-sync-status';

export function observeNativeStickyWrites(page:Page,boardId:string){
  let updates=0;
  page.on('websocket',socket=>{if(socket.url().includes(`/whiteboards/${boardId}/sync`))socket.on('framesent',frame=>{
    const event=JSON.parse(frame.payload.toString()) as {type?:string};if(event.type==='update')updates++;
  });});
  return ()=>updates;
}

/** Keyboard arms one creation; only native blank-canvas input creates content. */
export async function createNativeSticky(page:Page,text:string,proof:{api:APIRequestContext;token:string;boardId:string;updates:()=>number}){
  await expectBoardSynced(page,30_000);
  const before=await canonicalRows(page);
  const armedSnapshot=await canonicalBoardSnapshot(proof.api,proof.token,proof.boardId),armedHead=await boardHead(proof.api,proof.token,proof.boardId),armedUpdates=proof.updates();
  await page.getByTestId('board-tool-select').focus();
  await page.keyboard.press('n');
  await expect(page.getByTestId('board-add-sticky')).toHaveAttribute('aria-pressed','true');
  expect(await canonicalRows(page)).toEqual(before);
  expect(await canonicalBoardSnapshot(proof.api,proof.token,proof.boardId)).toEqual(armedSnapshot);
  expect(await boardHead(proof.api,proof.token,proof.boardId)).toEqual(armedHead);expect(proof.updates()).toBe(armedUpdates);
  const blankPoint=async(expectedCount:number)=>page.getByTestId('board-fabric-surface').evaluate((host,count)=>{
    const canvas=host.querySelector('canvas.upper-canvas');if(!canvas)throw new Error('MISSING_NATIVE_CANVAS');
    const box=canvas.getBoundingClientRect(),data=(host as HTMLElement).dataset;
    if(![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0)throw new Error('INVALID_NATIVE_CANVAS_BOUNDS');
    const zoom=Number(data.viewportZoom),panX=Number(data.viewportPanX),panY=Number(data.viewportPanY);
    if(![zoom,panX,panY].every(Number.isFinite)||zoom<=0)throw new Error('INVALID_NATIVE_VIEWPORT');
    const occupied=Array.from(document.querySelectorAll('[data-testid="board-a11y-mirror"] li[data-geometry]')).map(node=>{
      const g=JSON.parse(node.getAttribute('data-geometry')!);
      if(![g.x,g.y,g.width,g.height,g.rotation].every(Number.isFinite)||g.width<=0||g.height<=0)throw new Error('INVALID_NATIVE_OBJECT_GEOMETRY');
      const angle=g.rotation*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
      return {x:(g.x+g.width/2)*zoom+panX,y:(g.y+g.height/2)*zoom+panY,
        width:(g.width*c+g.height*s)*zoom,height:(g.width*s+g.height*c)*zoom};
    });
    if(occupied.length!==count)throw new Error('NATIVE_GEOMETRY_COUNT_MISMATCH');
    for(let y=100;y<box.height-180;y+=28)for(let x=40;x<box.width-40;x+=28){
      if(document.elementFromPoint(box.x+x,box.y+y)!==canvas)continue;
      if(occupied.some(g=>Math.abs(x-g.x)<=g.width/2+24&&Math.abs(y-g.y)<=g.height/2+24))continue;
      return{x:box.x+x,y:box.y+y};
    }
    throw new Error('NO_NATIVE_BLANK_POSITION');
  },expectedCount);
  const point=await blankPoint(before.length);
  expect(await canonicalRows(page)).toEqual(before);
  await page.mouse.click(point.x,point.y);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expectBoardSynced(page,30_000);
  await expect.poll(async()=> (await canonicalRows(page)).length).toBe(before.length+1);
  await expect(page.getByTestId('board-tool-select')).toHaveAttribute('aria-pressed','true');
  await expect(page.getByTestId('board-add-sticky')).toHaveAttribute('aria-pressed','false');
  const editor=page.getByLabel('对象文字',{exact:true});
  await expect(editor).toBeFocused();await editor.fill(text);await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  const created=(await canonicalRows(page)).filter(row=>!before.some(old=>old.id===row.id));
  expect(created).toHaveLength(1);expect(created[0]).toMatchObject({kind:'sticky',text});
  expect((await canonicalRows(page)).filter(row=>row.id!==created[0].id)).toEqual(before);
  await expectBoardSynced(page,30_000);
  const snapshot=await canonicalBoardSnapshot(proof.api,proof.token,proof.boardId),head=await boardHead(proof.api,proof.token,proof.boardId),updates=proof.updates();
  // A second real click cannot repeat the disarmed creation.
  const nextPoint=await blankPoint(before.length+1);
  await page.mouse.click(nextPoint.x,nextPoint.y);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expectBoardSynced(page,30_000);
  expect(await canonicalRows(page)).toEqual([...before,created[0]].sort((a,b)=>a.id.localeCompare(b.id)));
  expect(await canonicalBoardSnapshot(proof.api,proof.token,proof.boardId)).toEqual(snapshot);
  expect(await boardHead(proof.api,proof.token,proof.boardId)).toEqual(head);expect(proof.updates()).toBe(updates);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expectBoardSynced(page,30_000);
  expect(await canonicalBoardSnapshot(proof.api,proof.token,proof.boardId)).toEqual(snapshot);
  expect(await boardHead(proof.api,proof.token,proof.boardId)).toEqual(head);expect(proof.updates()).toBe(updates);
  return created[0];
}
