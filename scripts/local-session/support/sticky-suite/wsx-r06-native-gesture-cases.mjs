import assert from 'node:assert/strict';
import {rotatedPoint,assertNotePlacement} from './wsx-r06-sticky-oracles.mjs';

const equalState=(before,after)=>assert.deepEqual(after,before,'gesture must not change canonical/head while held or cancelled');
const appearance=(ctx,note,variant,color)=>{
 assert.equal(note.extensionData.thinkingInput.sticky.variant,variant);
 assert(ctx.colors[color],'source-bound canonical color preset required');
 assert.equal(note.extensionData.thinkingInput.sticky.color.toUpperCase(),ctx.colors[color].toUpperCase());
};
const oneCreate=(before,after)=>{
 assert.equal(after.head.epoch,before.head.epoch);assert.equal(after.head.seq,before.head.seq+1);
 assert.equal(after.objects.length,before.objects.length+1);
 for(const object of before.objects)assert.deepEqual(after.objects.find(next=>next.id===object.id),object,'existing object changed during creation');
 const created=after.objects.filter(next=>!before.objects.some(object=>object.id===next.id));assert.equal(created.length,1);return created[0];
};
/** The supplied context owns an isolated frozen runtime and dedicated fixture lifecycle. */
export async function runStickyOverlap(ctx){
 const{page,state,poll,view,choose,shot}=ctx,receipts=[];
 for(const kind of ['sticky','rectangle']){
  const before=await state(),target=before.objects.find(object=>object.kind===kind);assert(target,`native-created ${kind} fixture required`);
  await page.getByTestId('board-a11y-mirror').locator(`li[data-object-id="${target.id}"]`).getByRole('button').focus();
  await page.keyboard.press('Enter');
  const editor=page.getByTestId('board-thinking-editor');if(await editor.isVisible())await editor.press('Escape');
  await choose('circle','blue');equalState(before,await state());
  const viewport=await view(),world=rotatedPoint(target.geometry,{x:target.geometry.width/2,y:target.geometry.height/2});
  const point={x:viewport.x+viewport.panX+viewport.zoom*world.x,y:viewport.y+viewport.panY+viewport.zoom*world.y};
  assert(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.getAttribute('data-fabric')==='top',point),'old toolbar must not cover overlap hit');
  await page.mouse.click(point.x,point.y);
  const after=await poll(value=>value.objects.length===before.objects.length+1&&value.head.seq===before.head.seq+1),created=oneCreate(before,after);
  assertNotePlacement(created.geometry,point,viewport);appearance(ctx,created,'circle','blue');
  assert.equal(await page.getByTestId('board-tool-select').getAttribute('aria-pressed'),'true');
  await shot(`S03-${kind}-overlap`);receipts.push({kind,targetId:target.id,createdId:created.id,beforeSeq:before.head.seq,afterSeq:after.head.seq});
  if(await editor.isVisible())await editor.press('Escape');
 }
 return{case:'S03',receipts};
}
async function nativeDragHeld(ctx,target){
 const source=ctx.page.getByTestId('board-add-sticky'),box=await source.boundingBox();assert(box);
 assert(await source.evaluate(element=>{const r=element.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit&&element.contains(hit);}));
 await ctx.page.mouse.move(box.x+box.width/2,box.y+box.height/2);await ctx.page.mouse.down();
 await ctx.page.mouse.move(box.x+box.width/2+12,box.y+box.height/2-12,{steps:4});
 await ctx.page.mouse.move(target.x,target.y,{steps:12});
 await ctx.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
export async function runStickyNativeDrop(ctx){
 await ctx.choose('rectangle','pink');const before=await ctx.state(),viewport=await ctx.view(),point=await ctx.blank();
 await nativeDragHeld(ctx,point);equalState(before,await ctx.state());await ctx.shot('S04-held');
 await ctx.page.mouse.up();
 const after=await ctx.poll(value=>value.objects.length===before.objects.length+1&&value.head.seq===before.head.seq+1),created=oneCreate(before,after);
 assertNotePlacement(created.geometry,point,viewport);appearance(ctx,created,'rectangle','pink');
 assert.equal(await ctx.page.getByTestId('board-tool-select').getAttribute('aria-pressed'),'true');
 const editor=ctx.page.getByTestId('board-thinking-editor');if(await editor.isVisible())await editor.press('Escape');
 const second=await ctx.blank();await ctx.page.mouse.click(second.x,second.y);equalState(after,await ctx.state());await ctx.shot('S04-committed');
 return{case:'S04',createdId:created.id,beforeSeq:before.head.seq,afterSeq:after.head.seq,heldUnchanged:true,nativeInput:'Playwright mouse HTML drag'};
}
export async function runStickyNativeCancel(ctx){
 const receipts=[];
 for(const mode of ['held-Escape','outside-board']){
  await ctx.choose('square','yellow');const before=await ctx.state(),point=await ctx.blank();await nativeDragHeld(ctx,point);
  equalState(before,await ctx.state());await ctx.shot(`S05-${mode}-held`);
  if(mode==='held-Escape')await ctx.page.keyboard.press('Escape');
  else{
   const outside={x:20,y:20};assert(await ctx.page.evaluate(p=>!document.elementFromPoint(p.x,p.y)?.closest('[data-testid="board-fabric-surface"]'),outside));
   await ctx.page.mouse.move(outside.x,outside.y,{steps:10});
  }
  await ctx.page.mouse.up();await ctx.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(typeof ctx.expectSynced,'function','actual strict sync barrier required for negative creation evidence');
  await ctx.expectSynced(ctx.owner);
  equalState(before,await ctx.state());
  assert.equal(await ctx.page.getByTestId('board-add-sticky').getAttribute('aria-pressed'),'false','cancelled native gesture must not leave Sticky creation armed');
  const idlePoint=await ctx.blank();await ctx.page.mouse.click(idlePoint.x,idlePoint.y);await ctx.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await ctx.expectSynced(ctx.owner);
  equalState(before,await ctx.state());await ctx.shot(`S05-${mode}-cancelled`);
  // Actual subsequent creation proves the input state was released, not only that no object appeared.
  const recovery=await runStickyNativeDrop(ctx);receipts.push({mode,recovery});
 }
 return{case:'S05',status:'native-Escape-and-outside-subset',requiredSuiteComplete:false,receipts,pending:['pointercancel','lost-capture']};
}
