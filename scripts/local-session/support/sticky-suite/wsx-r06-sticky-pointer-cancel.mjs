import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runStickyNativeDrop} from './wsx-r06-native-gesture-cases.mjs';

export function assertCancellationInputReceipt(receipt){
 assert(['browser-protocol-trusted-touch-cancel','browser-pointer-capture-api-release'].includes(receipt.input));
 assert.equal(receipt.hardwareVerified,false,'protocol/API integration must not claim hardware verification');
 const required=receipt.input==='browser-protocol-trusted-touch-cancel'?'pointercancel':'lostpointercapture';
 assert(receipt.events.some(event=>event.type===required&&event.isTrusted===true&&event.onTool===true),'actual trusted cancellation on tool is required');
 assert(receipt.events.some(event=>event.type==='pointerdown'&&event.isTrusted===true&&event.onTool===true),'actual trusted pointer start on tool is required');
 if(required==='lostpointercapture')assert.equal(receipt.captureAcquired,true,'real native API capture acquisition must be observed');
}
export function assertZeroMutationTransport(before,after){
 for(const value of [before.mutations,after.mutations,before.invalid,after.invalid])assert(Number.isInteger(value)&&value>=0,'actual finite mutation transport counters required');
 assert.equal(before.invalid,0,'pre-existing malformed WS frames invalidate zero-write evidence');
 assert.equal(after.invalid,0,'malformed WS frames invalidate zero-write evidence');
 assert.equal(after.mutations,before.mutations,'cancelled input and un-rearmed click must send zero WS updates');
}

async function installInputProbe(page,key){
 await page.evaluate(key=>{
  const source=document.querySelector('[data-testid="board-add-sticky"]');if(!source)throw Error('Sticky tool source absent');
  const events=[];
  const listener=event=>events.push({type:event.type,isTrusted:event.isTrusted,pointerId:event.pointerId,onTool:source.contains(event.target)});
  for(const type of ['pointerdown','pointercancel','gotpointercapture','lostpointercapture'])document.addEventListener(type,listener,true);
  window[key]={events,source,remove:()=>{for(const type of ['pointerdown','pointercancel','gotpointercapture','lostpointercapture'])document.removeEventListener(type,listener,true);}};
 },key);
}
async function observe(page,key,type){
 await page.waitForFunction(({key,type})=>window[key].events.some(event=>event.type===type&&event.isTrusted&&event.onTool),{key,type},{timeout:2000});
 return page.evaluate(key=>window[key].events,key);
}
async function sourcePoint(page){
 const source=page.getByTestId('board-add-sticky'),box=await source.boundingBox();assert(box);
 assert([box.x,box.y,box.width,box.height].every(Number.isFinite)&&box.width>0&&box.height>0,'source box must have finite coordinates and positive dimensions');
 const point={x:box.x+box.width/2,y:box.y+box.height/2};
 assert(await page.evaluate(point=>Boolean(document.elementFromPoint(point.x,point.y)?.closest('[data-testid="board-add-sticky"]')),point),'tool must be physically hittable');
 return point;
}
async function confirmCancelled(ctx,before,name){
 await ctx.expectSynced(ctx.owner);
 await ctx.shot(`S05-${name}-after-cancel`);
 assert.equal(await ctx.page.getByTestId('board-add-sticky').getAttribute('aria-pressed'),'false','actual cancelled input must disarm creation');
 assert.deepEqual(await ctx.state(),before,'cancellation must not change canonical data');
 const blank=await ctx.blank();await ctx.page.mouse.click(blank.x,blank.y);
 await ctx.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await ctx.expectSynced(ctx.owner);
 assert.deepEqual(await ctx.state(),before,'un-rearmed canvas click after cancellation must not create');
 await ctx.shot(`S05-${name}-unrearmed-zero`);
 return {canonicalUnchanged:true};
}
export async function runStickyPointerCancellationCoverage(ctx){
 assert.equal(typeof ctx.expectSynced,'function','strict actual sync barrier required');
 assert.equal(typeof ctx.readMutationTransport,'function','actual browser WS mutation monitor required');
 const receipts=[];
 for(const input of ['browser-protocol-trusted-touch-cancel','browser-pointer-capture-api-release']){
  await ctx.choose('square','yellow');const before=await ctx.state(),transport=ctx.readMutationTransport(ctx.owner),point=await sourcePoint(ctx.page),key=`r06Cancellation${randomUUID().replaceAll('-','')}`;
  let cdp,primary,receipt,captureAcquired=false;
  try{
   await installInputProbe(ctx.page,key);
   if(input==='browser-protocol-trusted-touch-cancel'){
    cdp=await ctx.owner.context.newCDPSession(ctx.page);
    await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1,radiusX:1,radiusY:1,force:1}]});
    await observe(ctx.page,key,'pointerdown');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    await observe(ctx.page,key,'pointercancel');
   }else{
    await ctx.page.mouse.move(point.x,point.y);await ctx.page.mouse.down();
    await observe(ctx.page,key,'pointerdown');
    captureAcquired=await ctx.page.evaluate(key=>{
     const probe=window[key],start=probe.events.find(event=>event.type==='pointerdown'&&event.isTrusted&&event.onTool);
     probe.source.setPointerCapture(start.pointerId);return probe.source.hasPointerCapture(start.pointerId);
    },key);
    assert.equal(captureAcquired,true);
    await ctx.page.mouse.move(point.x+1,point.y+1);
    await observe(ctx.page,key,'gotpointercapture');
    await ctx.page.evaluate(key=>{const probe=window[key],start=probe.events.find(event=>event.type==='pointerdown'&&event.isTrusted&&event.onTool);probe.source.releasePointerCapture(start.pointerId);},key);
    await ctx.page.mouse.move(point.x+2,point.y+2);
    await observe(ctx.page,key,'lostpointercapture');
    // Release away from the tool so a native click does not rearm creation.
    await ctx.page.mouse.move(20,20);await ctx.page.mouse.up();
   }
   receipt={input,hardwareVerified:false,captureAcquired,events:await ctx.page.evaluate(key=>window[key].events,key)};
   assertCancellationInputReceipt(receipt);
   await confirmCancelled(ctx,before,input);
   const until=Date.now()+1000;let observations=0;
   while(Date.now()<until){
    await ctx.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await ctx.expectSynced(ctx.owner);assert.deepEqual(await ctx.state(),before,'late canonical write after cancelled input');
    const actual=ctx.readMutationTransport(ctx.owner);
    assertZeroMutationTransport(transport,actual);
    observations++;
   }
   receipt.negativeWindow={durationMs:1000,observations,wsMutationDelta:0};
   receipt.recovery=await runStickyNativeDrop(ctx);
  }catch(error){primary=error;}
  const cleanup=[];
  for(const action of [()=>ctx.page.mouse.up(),()=>ctx.page.evaluate(key=>{window[key]?.remove();delete window[key];},key),async()=>{if(cdp)await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false});},async()=>{if(cdp)await cdp.detach();}])try{await action();}catch(error){cleanup.push(error);}
  if(primary||cleanup.length)throw new AggregateError([...(primary?[primary]:[]),...cleanup],`${input} execution/cleanup failed`);
  receipts.push(receipt);
 }
 return{coverage:['pointercancel','lost-capture'],receipts,inputEvidenceBoundary:'trusted browser protocol and actual browser capture API; not physical hardware'};
}
