import assert from 'node:assert/strict';
import {rotatedPoint} from './wsx-r06-sticky-oracles.mjs';
import {assertLiveStickyChrome} from './wsx-r06-live-chrome-cases.mjs';
const screen=(point,v)=>({x:v.x+v.panX+point.x*v.zoom,y:v.y+v.panY+point.y*v.zoom});
export async function runStickyLiveResizeRotationEdges(ctx){
 const receipts=[];
 for(const mode of ['resize','rotation']){
  const id=await ctx.createStickyNative('rectangle','yellow'),targetId=await ctx.createStickyNative('square','blue');
  await ctx.seedExistingConnector(id,targetId,{fromAnchor:'right',toAnchor:'left',type:'straight',startStyle:'none',endStyle:'none'});
  await ctx.selectNative(ctx.owner,id);const before=await ctx.state(),note=before.objects.find(item=>item.id===id),target=before.objects.find(item=>item.id===targetId),v=await ctx.view();assert(note&&target);assert.equal(note.geometry.rotation,0);
  let start,end,expected;
  if(mode==='resize'){
   start=screen(rotatedPoint(note.geometry,{x:note.geometry.width,y:note.geometry.height}),v);end={x:start.x+40,y:start.y+40};
   // Fabric uniform corner scaling projects the pointer on the two local dimensions.
   const scale=(note.geometry.width+note.geometry.height+80/v.zoom)/(note.geometry.width+note.geometry.height);
   expected={...note.geometry,width:note.geometry.width*scale,height:note.geometry.height*scale};
  }else{
   assert.equal(ctx.rotationOffsetCss,40);const center=screen(rotatedPoint(note.geometry,{x:note.geometry.width/2,y:note.geometry.height/2}),v),radius=note.geometry.height*v.zoom/2+40,angle=60*Math.PI/180;
   start={x:center.x,y:center.y+radius};end={x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius};
   const r=-30*Math.PI/180,localCenter={x:note.geometry.width/2,y:note.geometry.height/2};
   const worldCenter=rotatedPoint(note.geometry,localCenter);
   expected={...note.geometry,x:worldCenter.x-Math.cos(r)*localCenter.x+Math.sin(r)*localCenter.y,y:worldCenter.y-Math.sin(r)*localCenter.x-Math.cos(r)*localCenter.y,rotation:-30};
  }
  assert(await ctx.page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.getAttribute('data-fabric')==='top',start));
  await ctx.page.mouse.move(start.x,start.y);await ctx.page.mouse.down();
  let chrome,path;
  try{
   await ctx.page.mouse.move(end.x,end.y,{steps:16});await ctx.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.deepEqual(await ctx.state(),before);chrome=await assertLiveStickyChrome(ctx.page,id,expected,v);
   path=await ctx.assertExistingEdgeRaster({movingEndpoint:rotatedPoint(expected,{x:expected.width,y:expected.height/2}),fixedEndpoint:rotatedPoint(target.geometry,{x:0,y:target.geometry.height/2}),view:v});
   await ctx.shot(`S11-${mode}-held`);
  }finally{await ctx.page.mouse.up();}
  const after=await ctx.poll(state=>state.head.seq===before.head.seq+1),saved=after.objects.find(item=>item.id===id);assert(saved);
  for(const key of ['x','y','width','height','rotation'])assert(Math.abs(saved.geometry[key]-expected[key])<=.01,`committed ${mode} ${key} differs from independent native pointer geometry`);
  assert.deepEqual(after.objects.find(item=>item.id===targetId),target);await ctx.shot(`S11-${mode}-committed`);receipts.push({mode,id,targetId,start,end,expected,chrome,path});
 }
 return{coverage:['resize live graph','rotation live graph'],receipts};
}
