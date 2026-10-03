import assert from 'node:assert/strict';
import {assertStickyTransformHistory} from './wsx-r06-history-persistence-cases.mjs';
async function assertMeasuredTextHistory(ctx,id,before,after,name){
 const original=before.objects.find(object=>object.id===id);assert(original);const undone=[];let current=after;
 await ctx.leaveEditor();await ctx.page.getByTestId('board-tool-select').click();
 for(let step=0;step<after.head.seq-before.head.seq;step++){
  await ctx.page.keyboard.press('ControlOrMeta+z');const next=await ctx.poll(value=>value.head.seq===current.head.seq+1),note=next.objects.find(object=>object.id===id);assert(note);
  assert.deepEqual(note.geometry,original.geometry);assert.deepEqual(note.style,original.style);undone.push({before:current,after:next,text:note.text});current=next;await ctx.shot(`${name}-native-undo-${step}`);
  if(note.text===original.text)break;
 }
 assert.equal(current.objects.find(object=>object.id===id)?.text,original.text,'native text history must reach the original draft without undoing unrelated work');
 for(const [index,entry]of undone.slice().reverse().entries()){
  await ctx.page.keyboard.press('ControlOrMeta+Shift+z');const next=await ctx.poll(value=>value.head.seq===current.head.seq+1),note=next.objects.find(object=>object.id===id);assert(note);
  assert.equal(note.text,entry.before.objects.find(object=>object.id===id).text);assert.deepEqual(note.geometry,original.geometry);assert.deepEqual(note.style,original.style);current=next;await ctx.shot(`${name}-native-redo-${index}`);
 }
 assert.equal(current.objects.find(object=>object.id===id)?.text,after.objects.find(object=>object.id===id)?.text);return{nativeUndoSteps:undone.length,texts:undone.map(entry=>entry.text)};
}
export async function runAllStickyHistoryTransactions(ctx,id){
 const receipts=[];
 for(const action of ['move','resize','rotation','color','shape','text']){
  const before=await ctx.state();let after;
  if(action==='move')after=(await ctx.dragNative(ctx.owner,id,{dx:31,dy:27})).after;
  else if(action==='resize')after=(await ctx.resizeNative(ctx.owner,id)).after;
  else if(action==='rotation')after=(await ctx.rotateNative(ctx.owner,id,-30)).after;
  else if(action==='text'){
   await ctx.editNative(ctx.owner,id,'One native fill / 历史文字\nDebounce granularity is measured, not assumed','command');after=await ctx.state();
  }else{
   await ctx.selectNative(ctx.owner,id);await ctx.page.getByTestId('board-sticky-style-open').click();
   await ctx.page.getByTestId(action==='color'?'sticky-quick-color-pink':'context-sticky-circle').click();await ctx.page.keyboard.press('Escape');
   after=await ctx.poll(value=>value.head.seq===before.head.seq+1);
   const note=after.objects.find(object=>object.id===id);assert(note);
   if(action==='color')assert.equal(note.extensionData.thinkingInput.sticky.color.toUpperCase(),ctx.colors.pink.toUpperCase());else assert.equal(note.extensionData.thinkingInput.sticky.variant,'circle');
  }
  const headDelta=after.head.seq-before.head.seq;assert(headDelta>0);if(action!=='text')assert.equal(headDelta,1);
  await ctx.shot(`S12-${action}-before-undo`);const granularity=action==='text'?await assertMeasuredTextHistory(ctx,id,before,after,'S12-text'):await assertStickyTransformHistory(ctx,ctx.owner,before,after,`S12-${action}`);
  receipts.push({action,headDelta,id,beforeSeq:before.head.seq,afterSeq:after.head.seq,granularity});
 }
 return{coverage:['move','resize','rotation','color','shape','text-history-measured'],receipts};
}
export async function createStickyPersistenceFixture(ctx){
 const id=await ctx.createStickyNative('rectangle','blue');await ctx.editNative(ctx.owner,id,'保存后的非默认便利贴\nExact persistent text','command');
 await ctx.dragNative(ctx.owner,id,{dx:31,dy:27});await ctx.resizeNative(ctx.owner,id);await ctx.rotateNative(ctx.owner,id,-30);
 const target=await ctx.createStickyNative('square','pink'),edgeId=await ctx.seedExistingConnector(id,target,{fromAnchor:'right',toAnchor:'left',type:'straight',startStyle:'none',endStyle:'none'});
 return{id,target,edgeId};
}
