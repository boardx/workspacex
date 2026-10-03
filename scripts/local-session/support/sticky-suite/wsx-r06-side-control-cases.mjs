import assert from 'node:assert/strict';
import {rotatedPoint} from './wsx-r06-sticky-oracles.mjs';
const screen=(point,v)=>({x:v.x+v.panX+point.x*v.zoom,y:v.y+v.panY+point.y*v.zoom});
export async function runStickySideAndForbiddenControls(ctx){
 const receipts=[];
 // A required side handle must be hit through native pointer input, not bypassed DOM dispatch.
 const id=await ctx.createStickyNative('rectangle','blue');await ctx.selectNative(ctx.owner,id);
 const before=await ctx.state(),note=before.objects.find(item=>item.id===id),v=await ctx.view();assert(note);assert.equal(note.geometry.rotation,0);
 const start=screen(rotatedPoint(note.geometry,{x:note.geometry.width,y:note.geometry.height/2}),v);
 assert(await ctx.page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.getAttribute('data-fabric')==='top',start),'required right resize handle is obscured by another widget');
 await ctx.page.mouse.move(start.x,start.y);await ctx.page.mouse.down();try{
  await ctx.page.mouse.move(start.x+40,start.y,{steps:12});await ctx.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.deepEqual(await ctx.state(),before);
 }finally{await ctx.page.mouse.up();}
 const after=await ctx.poll(value=>value.head.seq===before.head.seq+1),resized=after.objects.find(item=>item.id===id);assert(resized);
 assert(Math.abs(resized.geometry.width-note.geometry.width-40/v.zoom)<=.01);assert.equal(resized.geometry.height,note.geometry.height);await ctx.assertHistory(before,after,'S09-side-width');await ctx.shot('S09-native-side-width');receipts.push({mode:'fixed-right-side',id});
 for(const sizing of ['auto-size','auto-height']){
  const fixtureId=await ctx.createStickyNative('rectangle','pink'),initial=(await ctx.state()).objects.find(item=>item.id===fixtureId);assert(initial);
  await ctx.fixtureOperation(ctx.owner,[{type:'extension',id:fixtureId,key:'thinkingInput',value:{...initial.extensionData.thinkingInput,sticky:{...initial.extensionData.thinkingInput.sticky,sizing}}}]);
  await ctx.selectNative(ctx.owner,fixtureId);const policyBefore=await ctx.state(),current=policyBefore.objects.find(item=>item.id===fixtureId),viewport=await ctx.view();assert(current);
  const local=sizing==='auto-size'?{x:current.geometry.width,y:current.geometry.height}:{x:current.geometry.width/2,y:current.geometry.height},p=screen(rotatedPoint(current.geometry,local),viewport);
  const hit=await ctx.page.evaluate(point=>document.elementFromPoint(point.x,point.y)?.closest('[data-testid]')?.getAttribute('data-testid'),p);
  assert(!hit?.startsWith('board-connector-handle-'),'forbidden-size check must not mutate a connector instead of testing the note');
  await ctx.page.mouse.move(p.x,p.y);await ctx.page.mouse.down();try{await ctx.page.mouse.move(p.x+30,p.y+30,{steps:12});}finally{await ctx.page.mouse.up();}
  const policyAfter=await ctx.state(),saved=policyAfter.objects.find(item=>item.id===fixtureId);assert(saved);assert.equal(saved.geometry.width,current.geometry.width);assert.equal(saved.geometry.height,current.geometry.height);
  await ctx.shot(`S09-${sizing}-forbidden-resize`);receipts.push({mode:sizing,id:fixtureId,hit,width:saved.geometry.width,height:saved.geometry.height});
 }
 return{coverage:['side control policy','auto-size/auto-height forbidden controls'],receipts};
}
