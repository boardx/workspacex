import assert from 'node:assert/strict';
import {rotatedPoint} from './wsx-r06-sticky-oracles.mjs';
const canonical=state=>({epoch:state.head.epoch,seq:state.head.seq,objects:state.objects});
export function createReadonlyStickyAdapters(ctx){
 const assertReadOnlyTransformControls=async(actor,id)=>{
  await ctx.selectNative(actor,id);const before=await ctx.state(actor);assert.equal(before.head.role,'viewer');
  const note=before.objects.find(object=>object.id===id);assert(note);const v=await ctx.view(actor);
  for(const anchor of ['left','right','top','bottom'])assert.equal(await actor.page.getByTestId(`connector-handle-${id}-${anchor}`).count(),0,'viewer cannot receive writable connection handles');
  const points=[rotatedPoint(note.geometry,{x:note.geometry.width,y:note.geometry.height}),rotatedPoint(note.geometry,{x:note.geometry.width/2,y:note.geometry.height})];
  for(const [index,world]of points.entries()){
   const point={x:v.x+v.panX+world.x*v.zoom,y:v.y+v.panY+world.y*v.zoom+(index===1?40:0)};
   await actor.page.mouse.move(point.x,point.y);await actor.page.mouse.down();try{await actor.page.mouse.move(point.x+40,point.y+30,{steps:12});}finally{await actor.page.mouse.up();}
   assert.deepEqual(canonical(await ctx.state(actor)),canonical(before));
  }
  return{attempted:['corner-resize','rotation'],seq:before.head.seq};
 };
 const assertReadOnlyFullText=async(actor,id,text)=>{
  await ctx.selectNative(actor,id);const before=await ctx.state(actor);await actor.page.getByTestId('board-sticky-text-view').click();
  const input=actor.page.getByTestId('board-sticky-full-text');assert.equal(await input.inputValue(),text);assert.equal(await input.getAttribute('readonly'),'');
  await input.focus();await input.press('ControlOrMeta+End');
  const metrics=await input.evaluate(element=>({start:element.selectionStart,end:element.selectionEnd,scrollTop:element.scrollTop,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight}));
  assert.equal(metrics.end,text.length);if(metrics.scrollHeight>metrics.clientHeight)assert(metrics.scrollTop+metrics.clientHeight>=metrics.scrollHeight-2,'viewer must be able to reach actual text tail');
  await input.press('x');assert.equal(await input.inputValue(),text);assert.deepEqual(canonical(await ctx.state(actor)),canonical(before));
  await ctx.shot(actor,'S15-viewer-full-text-tail');await actor.page.getByRole('button',{name:'关闭全文',exact:true}).click();return metrics;
 };
 return{assertReadOnlyTransformControls,assertReadOnlyFullText};
}
