import assert from 'node:assert/strict';
import {rotatedPoint,assertNotePlacement} from './wsx-r06-sticky-oracles.mjs';

const canonical=state=>({epoch:state.head.epoch,seq:state.head.seq,objects:state.objects});
const screen=(point,view)=>({x:view.x+view.panX+point.x*view.zoom,y:view.y+view.panY+point.y*view.zoom});
const frame=actor=>actor.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
export function createStickyNativeActions(ctx,owner){
 const panNative=async(first,second,third)=>{
  const actor=typeof first==='number'?owner:first,dx=typeof first==='number'?first:second,dy=typeof first==='number'?second:third;
  const before=await ctx.state(actor),view=await ctx.view(actor),point={x:view.x+view.width*.5,y:view.y+view.height*.4};
  await actor.page.mouse.move(point.x,point.y);await actor.page.mouse.down({button:'middle'});
  try{await actor.page.mouse.move(point.x+dx,point.y+dy,{steps:12});}finally{await actor.page.mouse.up({button:'middle'});}
  await frame(actor);const after=await ctx.view(actor);assert(Math.abs(after.panX-view.panX-dx)<=.01&&Math.abs(after.panY-view.panY-dy)<=.01);
  assert.deepEqual(canonical(await ctx.state(actor)),canonical(before));return after;
 };
 const transform=async(actor,id,kind,delta)=>{
  await ctx.selectNative(actor,id);const before=await ctx.state(actor),note=before.objects.find(object=>object.id===id);assert(note);
  const view=await ctx.view(actor),start=screen(rotatedPoint(note.geometry,kind==='move'?{x:note.geometry.width/2,y:note.geometry.height/2}:{x:note.geometry.width,y:note.geometry.height}),view);
  assert(await actor.page.evaluate(point=>document.elementFromPoint(point.x,point.y)?.getAttribute('data-fabric')==='top',start),'native transform origin is obstructed');
  await actor.page.mouse.move(start.x,start.y);await actor.page.mouse.down();
  try{
   await actor.page.mouse.move(start.x+delta.dx,start.y+delta.dy,{steps:12});await frame(actor);
   assert.deepEqual(canonical(await ctx.state(actor)),canonical(before),'held preview cannot mutate canonical state');
  }finally{await actor.page.mouse.up();}
  const after=await ctx.poll(()=>ctx.state(actor),value=>value.head.seq===before.head.seq+1);
  assert.equal(after.objects.length,before.objects.length);assert.equal(after.head.epoch,before.head.epoch);
  const changed=after.objects.find(object=>object.id===id);assert(changed);assert.equal(changed.text,note.text);assert.deepEqual(changed.style,note.style);
  if(kind==='move'){
   assert(Math.abs(changed.geometry.x-note.geometry.x-delta.dx/view.zoom)<=.01);
   assert(Math.abs(changed.geometry.y-note.geometry.y-delta.dy/view.zoom)<=.01);
   assert.equal(changed.geometry.width,note.geometry.width);assert.equal(changed.geometry.height,note.geometry.height);assert.equal(changed.geometry.rotation,note.geometry.rotation);
  }else{
   assert(changed.geometry.width>note.geometry.width&&changed.geometry.height>note.geometry.height);
   if(note.extensionData.thinkingInput.sticky.variant!=='rectangle')assert(Math.abs(changed.geometry.width-changed.geometry.height)<=.01);
  }
  for(const old of before.objects)if(old.id!==id&&old.kind!=='connector')assert.deepEqual(after.objects.find(object=>object.id===old.id),old);
  return{before,after};
 };
 const rotateNative=async(actor,id,intended=-30)=>{
  await ctx.selectNative(actor,id);const before=await ctx.state(actor),note=before.objects.find(item=>item.id===id);assert(note);assert.equal(note.geometry.rotation,0);
  const v=await ctx.view(actor),center=screen(rotatedPoint(note.geometry,{x:note.geometry.width/2,y:note.geometry.height/2}),v),radius=note.geometry.height*v.zoom/2+40,r=(90+intended)*Math.PI/180;
  const start={x:center.x,y:center.y+radius},end={x:center.x+Math.cos(r)*radius,y:center.y+Math.sin(r)*radius};
  assert(await actor.page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.getAttribute('data-fabric')==='top',start));
  await actor.page.mouse.move(start.x,start.y);await actor.page.mouse.down();try{await actor.page.mouse.move(end.x,end.y,{steps:16});await frame(actor);assert.deepEqual(canonical(await ctx.state(actor)),canonical(before));}finally{await actor.page.mouse.up();}
  const after=await ctx.poll(()=>ctx.state(actor),value=>value.head.seq===before.head.seq+1),changed=after.objects.find(item=>item.id===id);assert(changed);
  assert(Math.abs(changed.geometry.rotation-intended)<=.01);assert.equal(changed.geometry.width,note.geometry.width);assert.equal(changed.geometry.height,note.geometry.height);assert.equal(changed.text,note.text);assert.deepEqual(changed.style,note.style);
  const newCenter=screen(rotatedPoint(changed.geometry,{x:changed.geometry.width/2,y:changed.geometry.height/2}),v);assert(Math.hypot(newCenter.x-center.x,newCenter.y-center.y)<=2);return{before,after};
 };
 const dropStickyNative=async(actor,variant,color)=>{
  await ctx.choose(actor,variant,color);const before=await ctx.state(actor),view=await ctx.view(actor),point=await ctx.blank(actor),source=await actor.page.getByTestId('board-add-sticky').boundingBox();assert(source);
  const start={x:source.x+source.width/2,y:source.y+source.height/2};
  await actor.page.mouse.move(start.x,start.y);await actor.page.mouse.down();try{
   await actor.page.mouse.move(start.x+12,start.y-12,{steps:4});await actor.page.mouse.move(point.x,point.y,{steps:12});await frame(actor);assert.deepEqual(canonical(await ctx.state(actor)),canonical(before));
  }finally{await actor.page.mouse.up();}
  const after=await ctx.poll(()=>ctx.state(actor),value=>value.head.seq===before.head.seq+1&&value.objects.length===before.objects.length+1),added=after.objects.filter(item=>!before.objects.some(old=>old.id===item.id));assert.equal(added.length,1);
  const note=added[0];assert.equal(note.extensionData.thinkingInput.sticky.variant,variant);assert.equal(note.extensionData.thinkingInput.sticky.color.toUpperCase(),ctx.colors[color].toUpperCase());assertNotePlacement(note.geometry,point,view);
  assert.equal(await actor.page.getByTestId('board-tool-select').getAttribute('aria-pressed'),'true');await ctx.leaveEditor(actor);return note.id;
 };
 return{panNative,rotateNative,dropStickyNative,dragNative:(actor,id,delta)=>transform(actor,id,'move',delta),resizeNative:(actor,id)=>transform(actor,id,'resize',{dx:40,dy:40})};
}
