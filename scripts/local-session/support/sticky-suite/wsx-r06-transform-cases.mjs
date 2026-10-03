import assert from 'node:assert/strict';
import {rotatedPoint} from './wsx-r06-sticky-oracles.mjs';
const note=(state,id)=>{const found=state.objects.find(item=>item.id===id);assert(found);return found;};
const screen=(point,view)=>({x:view.x+view.panX+point.x*view.zoom,y:view.y+view.panY+point.y*view.zoom});
async function select(ctx,id){
 const item=note(await ctx.state(),id),view=await ctx.view(),p=screen(rotatedPoint(item.geometry,{x:item.geometry.width/2,y:item.geometry.height/2}),view);
 await ctx.page.getByTestId('board-tool-select').click();await ctx.page.mouse.click(p.x,p.y);
 assert(await ctx.page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.getAttribute('data-fabric')==='top',p));
 await ctx.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 return{item,view};
}
async function committedTransform(ctx,id,before){
 const after=await ctx.poll(state=>state.head.seq===before.head.seq+1&&JSON.stringify(note(state,id).geometry)!==JSON.stringify(note(before,id).geometry));
 assert.equal(after.head.epoch,before.head.epoch);assert.equal(after.objects.length,before.objects.length);
 assert.equal(note(after,id).text,note(before,id).text);assert.deepEqual(note(after,id).style,note(before,id).style);
 for(const old of before.objects)if(old.id!==id&&old.kind!=='connector')assert.deepEqual(note(after,old.id),old);
 return after;
}
export async function runStickyResize(ctx){
 const receipts=[];
 for(const variant of ['square','rectangle','circle']){
  const id=await ctx.createStickyNative(variant,'blue'),{item,view}=await select(ctx,id),before=await ctx.state();
  assert.equal(item.geometry.rotation,0,'resize fixture begins unrotated');
  const start=screen(rotatedPoint(item.geometry,{x:item.geometry.width,y:item.geometry.height}),view);
  assert(await ctx.page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.getAttribute('data-fabric')==='top',start),'corner control unobstructed');
  const destination={x:start.x+40,y:start.y+40};
  await ctx.page.mouse.move(start.x,start.y);await ctx.page.mouse.down();await ctx.page.mouse.move(destination.x,destination.y,{steps:12});
  await ctx.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const scale=(item.geometry.width+item.geometry.height+80/view.zoom)/(item.geometry.width+item.geometry.height);
  const expected={...item.geometry,width:item.geometry.width*scale,height:item.geometry.height*scale};
  assert.deepEqual(await ctx.state(),before);await ctx.sampleLiveChrome(id,'resize',expected);await ctx.shot(`S09-${variant}-held`);
  await ctx.page.mouse.up();const after=await committedTransform(ctx,id,before),resized=note(after,id);
  assert(resized.geometry.width>item.geometry.width&&resized.geometry.height>item.geometry.height);
  if(variant!=='rectangle')assert(Math.abs(resized.geometry.width-resized.geometry.height)<=.01,'square/circle proportional policy');
  assert.equal(resized.geometry.rotation,0);await ctx.assertHistory(before,after,`S09-${variant}`);
  await ctx.shot(`S09-${variant}-committed`);receipts.push({variant,id,before:item.geometry,after:resized.geometry,start,destination});
 }
 return{case:'S09',status:'native-corner-proportional-subset',requiredSuiteComplete:false,receipts,pending:['side control policy','auto-size/auto-height forbidden controls']};
}
export async function runStickyRotation(ctx){
 const id=await ctx.createStickyNative('rectangle','pink');await ctx.panNative(31,27);
 const{item,view}=await select(ctx,id),before=await ctx.state();assert.equal(item.geometry.rotation,0);
 assert(Math.abs(view.panX)>1||Math.abs(view.panY)>1,'nonzero actual pan required');
 const center=screen(rotatedPoint(item.geometry,{x:item.geometry.width/2,y:item.geometry.height/2}),view);
 // Source-bound read-only control offset is supplied by the frozen visual contract,
 // while the pointer target and angle below are independently calculated.
 assert.equal(ctx.rotationOffsetCss,40);
 const radius=item.geometry.height*view.zoom/2+ctx.rotationOffsetCss,start={x:center.x,y:center.y+radius};
 const intended=-30,angle=(90+intended)*Math.PI/180,target={x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius};
 assert(await ctx.page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.getAttribute('data-fabric')==='top',start),'menu must not cover rotation control');
 await ctx.page.mouse.move(start.x,start.y);await ctx.page.mouse.down();await ctx.page.mouse.move(target.x,target.y,{steps:16});
 await ctx.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const r=intended*Math.PI/180,localCenter={x:item.geometry.width/2,y:item.geometry.height/2},worldCenter=rotatedPoint(item.geometry,localCenter);
 const expected={...item.geometry,x:worldCenter.x-Math.cos(r)*localCenter.x+Math.sin(r)*localCenter.y,y:worldCenter.y-Math.sin(r)*localCenter.x-Math.cos(r)*localCenter.y,rotation:intended};
 assert.deepEqual(await ctx.state(),before);await ctx.sampleLiveChrome(id,'rotate',expected);await ctx.shot('S10-rectangle-held');
 await ctx.page.mouse.up();const after=await committedTransform(ctx,id,before),rotated=note(after,id);
 assert(Math.abs(rotated.geometry.rotation-intended)<=.01,'canonical angle must match independent pointer angle');
 assert.equal(rotated.geometry.width,item.geometry.width);assert.equal(rotated.geometry.height,item.geometry.height);
 const nextCenter=screen(rotatedPoint(rotated.geometry,{x:rotated.geometry.width/2,y:rotated.geometry.height/2}),view);
 assert(Math.hypot(nextCenter.x-center.x,nextCenter.y-center.y)<=2,'rotation preserves its screen center');
 await ctx.assertHistory(before,after,'S10-rectangle');await ctx.shot('S10-rectangle-committed');
 return{case:'S10',id,start,target,intended,before:item.geometry,after:rotated.geometry};
}
