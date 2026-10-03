import assert from 'node:assert/strict';
import {rotatedPoint} from './wsx-r06-sticky-oracles.mjs';
const noteFrom=(state,id)=>{const note=state.objects.find(item=>item.id===id);assert(note,'native-created Sticky must remain');return note;};
async function edit(ctx,note){
 const view=await ctx.view(),p=rotatedPoint(note.geometry,{x:note.geometry.width/2,y:note.geometry.height/2});
 await ctx.page.mouse.dblclick(view.x+view.panX+p.x*view.zoom,view.y+view.panY+p.y*view.zoom);
 const editor=ctx.page.getByTestId('board-thinking-editor');await editor.waitFor();assert(await editor.isVisible());return editor;
}
export async function runStickyInlineText(ctx,id){
 const receipts=[];
 for(const commit of ['blur','command']){
  const before=await ctx.state(),old=noteFrom(before,id),input=await edit(ctx,old);
  const text=`便利贴原生编辑 ${commit}\nLatin words / 标点 ' %\n第三行完全保留`;
  await input.fill(text);
  if(commit==='blur')await ctx.page.getByTestId('board-tool-select').click();
  else await input.press('ControlOrMeta+Enter');
  const after=await ctx.poll(state=>noteFrom(state,id).text===text),next=noteFrom(after,id);
  assert.deepEqual(next.geometry,old.geometry);assert.equal(after.objects.length,before.objects.length);
  assert(after.head.seq>before.head.seq,'text commit must receive an actual new ACK');
  if(await input.isVisible())await input.press('Escape');
  await ctx.shot(`S06-${commit}-committed`);await ctx.page.reload();await ctx.surface().waitFor();
  assert.deepEqual(await ctx.state(),after);await ctx.shot(`S06-${commit}-reloaded`);
  receipts.push({commit,beforeSeq:before.head.seq,afterSeq:after.head.seq,text,historyGranularity:'measured native/debounced, not asserted whole-session-single-step'});
 }
 return{case:'S06',receipts};
}
export async function runStickyCompositionIntegration(ctx,id){
 const before=await ctx.state(),note=noteFrom(before,id),input=await edit(ctx,note);
 // Synthetic browser integration is deliberately separate from the native OS IME gate.
 await input.dispatchEvent('compositionstart',{data:''});await input.fill('正在组合中文');
 await input.dispatchEvent('compositionupdate',{data:'正在组合中文'});await input.press('Enter');
 const checks=[],until=Date.now()+1000;
 do{const current=await ctx.state();assert.deepEqual(current,before,'composition must not submit early');checks.push({observedAt:Date.now(),seq:current.head.seq});await new Promise(resolve=>setTimeout(resolve,150));}while(Date.now()<until);
 assert(await input.isVisible(),'composition Enter must not exit the editor');
 const final='正在组合中文\nFinal composed value';await input.fill(final);await input.dispatchEvent('compositionend',{data:final});
 await input.press('ControlOrMeta+Enter');const after=await ctx.poll(state=>noteFrom(state,id).text===final);
 assert.equal(after.objects.length,before.objects.length);assert.deepEqual(noteFrom(after,id).geometry,note.geometry);
 await ctx.shot('S07-browser-composition-committed');
 return{case:'S07',automation:'synthetic composition + native keyboard integration',checks,afterSeq:after.head.seq,nativeOSIME:'manual-required'};
}
export async function runStickyLongText(ctx){
 const texts={mixed:('中文 Latin 0123456789 / 保留所有内容\n'.repeat(160)).slice(0,3565),
  multiline:Array.from({length:100},(_,index)=>`第${index}行 / multiline remains`).join('\n'),unbroken:'LongUnbrokenWord'.repeat(240)};
 assert.equal(texts.mixed.length,3565);assert(Number.isFinite(ctx.minimumFontToken),'actual canonical caption token required');
 const receipts=[];
 for(const variant of ['square','rectangle','circle'])for(const[name,text]of Object.entries(texts)){
  const id=await ctx.createStickyNative(variant,'pink'),before=await ctx.state(),note=noteFrom(before,id),input=await edit(ctx,note);
  await input.fill(text);await input.press('ControlOrMeta+End');
  const metrics=await input.evaluate(element=>({value:element.value,scrollTop:element.scrollTop,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,fontSize:parseFloat(getComputedStyle(element).fontSize),overflowY:getComputedStyle(element).overflowY,selectionEnd:element.selectionEnd}));
  const view=await ctx.view();assert.equal(metrics.value,text);assert.equal(metrics.selectionEnd,text.length);
  assert.equal(metrics.overflowY,'auto');assert(metrics.scrollTop>0&&metrics.scrollHeight>metrics.clientHeight);
  assert(Math.abs(metrics.fontSize/view.zoom-ctx.minimumFontToken)<=.1,'render fit must use the actual font-floor token');
  await ctx.shot(`S08-${variant}-${name}-editor-tail`);
  await input.press('End');await input.press('!');const edited=text+'!';
  await input.press('ControlOrMeta+Enter');const after=await ctx.poll(state=>noteFrom(state,id).text===edited),saved=noteFrom(after,id);
  assert.deepEqual(saved.geometry,note.geometry);assert.equal(saved.style.fontSize,note.style.fontSize,'font fit is render-only');
  await ctx.page.reload();await ctx.surface().waitFor();assert.deepEqual(await ctx.state(),after);
  await ctx.shot(`S08-${variant}-${name}-reloaded`);
  receipts.push({variant,name,id,characters:edited.length,metrics,beforeGeometry:note.geometry,afterGeometry:saved.geometry});
  await ctx.deleteStickyNative(ctx.owner,id);
 }
 return{case:'S08',status:'fixed-shape-font-floor-tail-subset',requiredSuiteComplete:false,receipts,pending:['rotated-circle lower-canvas glyph ROI','legacy compatibility fixtures']};
}
