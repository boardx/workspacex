import assert from 'node:assert/strict';
import {assertNotePlacement} from './wsx-r06-sticky-oracles.mjs';
const canonical=state=>({epoch:state.head.epoch,seq:state.head.seq,objects:state.objects});
async function waitZoom(actor,wanted){
 const surface=actor.page.getByTestId('board-fabric-surface'),until=Date.now()+5000;
 while(Date.now()<until){const actual=Number(await surface.getAttribute('data-viewport-zoom'));if(Math.abs(actual-wanted)<.001)return actual;await new Promise(resolve=>setTimeout(resolve,50));}
 throw Error(`actual native wheel did not reach zoom ${wanted}`);
}
export async function runStickyZoomDpr(ctx){
 const receipts=[];
 for(const dpr of [1,2])for(const zoom of [.5,1.65,2]){
  const actor=await ctx.launchFreshOwner({dpr,viewport:{width:1440,height:900}});
  try{
   assert.equal(await actor.page.evaluate(()=>devicePixelRatio),dpr);
   const surface=actor.page.getByTestId('board-fabric-surface'),beforeNavigation=await ctx.state(actor),initial=Number(await surface.getAttribute('data-viewport-zoom'));
   await actor.page.mouse.move(700,350);await actor.page.keyboard.down('Control');
   try{await actor.page.mouse.wheel(0,Math.log(zoom/initial)/Math.log(.998));}finally{await actor.page.keyboard.up('Control');}
   await waitZoom(actor,zoom);await actor.page.mouse.move(700,350);await actor.page.mouse.down({button:'middle'});await actor.page.mouse.move(731,377,{steps:10});await actor.page.mouse.up({button:'middle'});
   assert.deepEqual(canonical(await ctx.state(actor)),canonical(beforeNavigation));const view=await ctx.view(actor);assert(Math.abs(view.panX)>1||Math.abs(view.panY)>1);
   for(const variant of ['square','rectangle','circle']){
    const before=await ctx.state(actor),point=await ctx.blank(actor),id=await ctx.createStickyNative(actor,variant,'blue',point),created=await ctx.state(actor),note=created.objects.find(item=>item.id===id);assert(note);
    assert.equal(created.head.seq,before.head.seq+1);assertNotePlacement(note.geometry,point,view);
    await ctx.assertRenderedNote(actor,id,note);await ctx.dragNative(actor,id,{dx:31,dy:27});
    await ctx.editNative(actor,id,`DPR${dpr} zoom${zoom} / ${variant}\n中文与Latin`, 'command');
    await ctx.resizeNative(actor,id);await ctx.sampleLiveChrome(actor,id,'zoom-dpr');
    const saved=await ctx.state(actor);await ctx.shot(actor,`S17-dpr${dpr}-zoom${zoom}-${variant}`);
    await ctx.reloadActor(actor);assert.deepEqual(canonical(await ctx.state(actor)),canonical(saved));await ctx.assertRenderedNote(actor,id,saved.objects.find(item=>item.id===id));
    receipts.push({dpr,zoom,variant,id,view,seq:saved.head.seq});await ctx.deleteStickyNative(actor,id);
   }
  }finally{await ctx.cleanupFreshOwner(actor);}
 }
 return{case:'S17',receipts,hardwareTrackpad:'manual-required',automatedInput:'native Playwright wheel and middle-button pan'};
}
export async function runStickyNarrow(ctx){
 const actor=await ctx.launchFreshOwner({dpr:1,viewport:{width:390,height:844}}),receipts=[];
 try{
  const selected=await ctx.createStickyNative(actor,'square','yellow');await ctx.selectNative(actor,selected);
  for(const[color,hex]of Object.entries(ctx.colors))for(const variant of ['square','rectangle','circle']){
   const before=await ctx.state(actor);await ctx.choose(actor,variant,color);
   const picker=actor.page.getByTestId('board-sticky-picker');await picker.waitFor();
   const box=await picker.boundingBox();assert(box&&box.x>=0&&box.y>=64&&box.x+box.width<=390&&box.y+box.height<=844);
   const hits=[];
   for(const button of await picker.locator('button').all()){
    if(await button.isDisabled())continue;
    const hit=await button.evaluate(element=>{const r=element.getBoundingClientRect(),target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{id:element.dataset.testid,ok:target&&element.contains(target),bounds:{x:r.x,y:r.y,width:r.width,height:r.height}};});
    assert(hit.ok,`selected-object chrome overlaps ${hit.id}`);hits.push(hit);
   }
   assert.equal(await actor.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await ctx.samplePickerPixels(actor,variant,color);assert.deepEqual(canonical(await ctx.state(actor)),canonical(before));
   const point=await ctx.blank(actor),id=await ctx.placeArmedStickyNative(actor,point),after=await ctx.state(actor),note=after.objects.find(item=>item.id===id);assert(note);
   assert.equal(after.head.seq,before.head.seq+1);assert.equal(note.extensionData.thinkingInput.sticky.variant,variant);assert.equal(note.extensionData.thinkingInput.sticky.color.toUpperCase(),hex.toUpperCase());
   await ctx.assertRenderedNote(actor,id,note);await ctx.shot(actor,`S18-390-${color}-${variant}-click`);await ctx.deleteStickyNative(actor,id);
   const dragged=await ctx.dropStickyNative(actor,variant,color);await ctx.shot(actor,`S18-390-${color}-${variant}-native-drop`);await ctx.deleteStickyNative(actor,dragged);
   await ctx.selectNative(actor,selected);receipts.push({color,variant,hits,createdId:id,draggedId:dragged});
  }
 }finally{await ctx.cleanupFreshOwner(actor);}
 return{case:'S18',receipts};
}
