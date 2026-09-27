import {expect,type Page} from '@playwright/test';

/** Warmup only: use the actual tool + blank canvas placement flow. No API writes,
 * injected document state or shortened measured writer rounds. */
export async function createSoakWriterNote(page:Page,index:number){
 const label=`Soak writer ${index}: warmup`;
 await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(index);
 await page.getByTestId('board-add-sticky').click();
 const surface=page.getByTestId('board-fabric-surface');
 const canvas=surface.locator('canvas.upper-canvas');
 await expect(canvas).toBeVisible();
 let point:{x:number;y:number}|null=null;
 // At most two real pans reveal adjacent blank space on a full viewport. No
 // wait/retry loop may conceal a creation failure or extend the 30-minute run.
 for(let attempt=0;attempt<3;attempt++){
  point=await surface.evaluate(host=>{
   const canvas=host.querySelector('canvas.upper-canvas');if(!canvas)return null;
   const box=canvas.getBoundingClientRect(),data=(host as HTMLElement).dataset;
   const zoom=Number(data.viewportZoom),panX=Number(data.viewportPanX),panY=Number(data.viewportPanY);
   if(![zoom,panX,panY].every(Number.isFinite)||zoom<=0)throw new Error('MISSING_REAL_VIEWPORT');
   const occupied=Array.from(document.querySelectorAll('[data-testid="board-a11y-mirror"] li[data-geometry]')).map(node=>JSON.parse(node.getAttribute('data-geometry')!) as {x:number;y:number;width:number;height:number});
   for(let y=120;y<box.height-200;y+=36)for(let x=120;x<box.width-100;x+=36){
    if(document.elementFromPoint(box.x+x,box.y+y)!==canvas)continue;
    if(occupied.some(g=>x>=g.x*zoom+panX-12&&x<=((g.x+g.width)*zoom+panX)+12&&y>=g.y*zoom+panY-12&&y<=((g.y+g.height)*zoom+panY)+12))continue;
    return{x:box.x+x,y:box.y+y};
   }return null;
  });
  if(point)break;
  if(attempt===2)break;
  const box=await canvas.boundingBox();expect(box).not.toBeNull();
  await page.getByTestId('board-tool-hand').click();
  await page.mouse.move(box!.x+box!.width*.75,box!.y+box!.height*.4);await page.mouse.down();
  await page.mouse.move(box!.x+box!.width*.25,box!.y+box!.height*.4,{steps:8});await page.mouse.up();
  await page.getByTestId('board-add-sticky').click();
 }
 expect(point,'No observable blank canvas position for a real warmup sticky').not.toBeNull();
 await page.mouse.click(point!.x,point!.y);
 const editor=page.getByLabel('对象文字',{exact:true});await expect(editor).toBeFocused();await editor.fill(label);
 await expect(page.getByTestId('board-a11y-mirror').getByRole('button',{name:`图形：${label}`,exact:true})).toHaveCount(1);
 // Leave this writer's real textarea focused for the unchanged concurrent rounds.
 await expect(editor).toBeFocused();
}
