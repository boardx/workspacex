import assert from 'node:assert/strict';
import {assertStickyPixels} from './wsx-r06-sticky-oracles.mjs';
import {assertCircleGlyphClipping} from './wsx-r06-circle-glyph-oracle.mjs';
import {assertStickyPaperAndTextPixels} from './wsx-r06-paper-text-oracle.mjs';

export async function decodeScreenshotRaster(actor,png){
 const decoded=await actor.page.evaluate(async base64=>{
  const bytes=Uint8Array.from(atob(base64),character=>character.charCodeAt(0));
  const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
  try{
   const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d');
   if(!context)throw Error('PNG decoder has no 2D context');
   context.drawImage(bitmap,0,0);
   return{width:bitmap.width,height:bitmap.height,rgba:Array.from(context.getImageData(0,0,bitmap.width,bitmap.height).data)};
  }finally{bitmap.close();}
 },png.toString('base64'));
 return{png,width:decoded.width,height:decoded.height,rgba:Uint8Array.from(decoded.rgba)};
}
export async function readCompositedRaster(actor){
 return decodeScreenshotRaster(actor,await actor.page.screenshot({animations:'disabled',scale:'device'}));
}

export async function readCanvasRaster(actor){
 const values=await actor.page.getByTestId('board-fabric-surface').locator('canvas.lower-canvas').evaluate(canvas=>{
  const context=canvas.getContext('2d');
  if(!context)throw Error('actual Fabric lower canvas has no 2D context');
  return{width:canvas.width,height:canvas.height,rgba:Array.from(context.getImageData(0,0,canvas.width,canvas.height).data)};
 });
 return{width:values.width,height:values.height,rgba:Uint8Array.from(values.rgba)};
}

export function createStickyRasterReaders(ctx){
 const preview=async(actor,locator,variant,color)=>{
  const box=await locator.boundingBox();assert(box&&box.width>0&&box.height>0);
  const png=await locator.screenshot({animations:'disabled',scale:'device'}),raster=await decodeScreenshotRaster(actor,png);
  return assertStickyPixels({...raster,geometry:{x:0,y:0,width:box.width,height:box.height,rotation:0},viewport:{x:0,y:0,panX:0,panY:0,zoom:1,dpr:raster.width/box.width},variant,color:ctx.colors[color]});
 };
 const samplePickerPixels=async(actor,variant,color)=>{
  const receipts=[];for(const shape of ['square','rectangle','circle'])receipts.push(await preview(actor,actor.page.getByTestId(`board-sticky-${shape}`).locator('span'),shape,color));
  return receipts;
 };
 const sampleDockPixels=async(actor,variant,color)=>{
  const locator=actor.page.getByTestId('board-add-sticky').locator('[data-sticky-variant]');
  assert.equal(await locator.getAttribute('data-sticky-variant'),variant);return preview(actor,locator,variant,color);
 };
 const sampleSelectedStickyColor=async(actor,id,color)=>{
  await ctx.selectNative(actor,id);const note=(await ctx.state(actor)).objects.find(item=>item.id===id);assert(note);
  const canonicalColor=note.extensionData?.thinkingInput?.sticky?.color??note.style.fill;
  assert.equal(canonicalColor.toUpperCase(),ctx.colors[color].toUpperCase());
  return preview(actor,actor.page.getByTestId('board-sticky-style-open').locator('span'),'circle',color);
 };
 const assertBlankRenderedNote=async(actor,id)=>{
  const state=await ctx.state(actor),note=state.objects.find(object=>object.id===id);assert(note);
  assert.equal(note.text,'','blank-fill oracle cannot accept text over its sampling points');
  await ctx.clearSelectionNative(actor);
  assert.equal(await actor.page.getByTestId('board-context-toolbar').isVisible(),false,'selection must be cleared before raster oracle');
  const raster=await readCanvasRaster(actor),viewport={...await ctx.view(actor),x:0,y:0};
  const sticky=note.extensionData.thinkingInput.sticky;
  return assertStickyPixels({...raster,geometry:note.geometry,viewport,variant:sticky.variant,color:sticky.color});
 };
 const assertRenderedNote=async(actor,id,expected)=>{
  const note=(await ctx.state(actor)).objects.find(object=>object.id===id);assert(note);assert.deepEqual(note,expected);
  const row=actor.page.getByTestId('board-a11y-mirror').locator(`li[data-object-id="${id}"]`);await row.waitFor({state:'attached'});
  await ctx.poll(async()=>row.evaluate(element=>({text:element.dataset.objectText,geometry:JSON.parse(element.dataset.geometry)})),value=>value.text===note.text&&['x','y','width','height','rotation'].every(key=>Math.abs(value.geometry[key]-note.geometry[key])<=.01));
  await ctx.expectSynced(actor);
  await ctx.clearSelectionNative(actor);
  const raster=await readCanvasRaster(actor),sticky=note.extensionData?.thinkingInput?.sticky;
  assert(sticky,'native note renderer oracle requires canonical thinkingInput metadata');
  return assertStickyPaperAndTextPixels({...raster,geometry:note.geometry,view:await ctx.view(actor),color:sticky.color,variant:sticky.variant,hasText:note.text.length>0});
 };
 const assertRotatedCircleGlyphs=async(actor,id,layer)=>{
  assert(['canvas-static','composited-editor'].includes(layer));
  const note=(await ctx.state(actor)).objects.find(object=>object.id===id);assert(note);
  assert.equal(note.extensionData.thinkingInput.sticky.variant,'circle');assert(note.text.length>0);
  let raster,viewport=await ctx.view(actor);
  if(layer==='canvas-static'){
   await ctx.clearSelectionNative(actor);
   assert.equal(await actor.page.getByTestId('board-context-toolbar').isVisible(),false);
   raster=await readCanvasRaster(actor);viewport={...viewport,x:0,y:0};
  }else{
   assert.equal(await actor.page.getByTestId('board-thinking-editor').isVisible(),true);
   raster=await readCompositedRaster(actor);
  }
  return assertCircleGlyphClipping({...raster,geometry:note.geometry,view:viewport,layer});
 };
 return{assertBlankRenderedNote,assertRenderedNote,assertRotatedCircleGlyphs,samplePickerPixels,sampleDockPixels,sampleSelectedStickyColor};
}
