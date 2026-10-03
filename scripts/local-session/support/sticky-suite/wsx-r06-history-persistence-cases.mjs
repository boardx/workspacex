import assert from 'node:assert/strict';
const canonical=state=>({epoch:state.head.epoch,seq:state.head.seq,objects:state.objects});
const semantic=object=>{const{revision,createdAt,updatedAt,...rest}=object;return rest;};
const objects=state=>state.objects.map(semantic).sort((a,b)=>a.id.localeCompare(b.id));
async function leaveEditor(ctx,actor){const editor=actor.page.getByTestId('board-thinking-editor');if(await editor.isVisible())await editor.press('Escape');}
export async function assertStickyTransformHistory(ctx,actor,before,after,name){
 await leaveEditor(ctx,actor);await actor.page.getByTestId('board-tool-select').click();await actor.page.keyboard.press('ControlOrMeta+z');
 const undo=await ctx.poll(()=>ctx.state(actor),value=>JSON.stringify(objects(value))===JSON.stringify(objects(before)));
 assert.equal(undo.head.seq,after.head.seq+1);assert.equal(undo.head.epoch,after.head.epoch);await ctx.shot(actor,`${name}-undo`);
 await actor.page.keyboard.press('ControlOrMeta+Shift+z');
 const redo=await ctx.poll(()=>ctx.state(actor),value=>JSON.stringify(objects(value))===JSON.stringify(objects(after)));
 assert.equal(redo.head.seq,undo.head.seq+1);assert.equal(redo.head.epoch,undo.head.epoch);await ctx.shot(actor,`${name}-redo`);return redo;
}
export async function assertStickyCreateHistory(ctx,actor,before,after,id){
 await leaveEditor(ctx,actor);await actor.page.getByTestId('board-tool-select').click();await actor.page.keyboard.press('ControlOrMeta+z');
 const undo=await ctx.poll(()=>ctx.state(actor),value=>JSON.stringify(objects(value))===JSON.stringify(objects(before)));assert.equal(undo.head.seq,after.head.seq+1);
 await actor.page.keyboard.press('ControlOrMeta+Shift+z');
 const redo=await ctx.poll(()=>ctx.state(actor),value=>value.head.seq===undo.head.seq+1&&value.objects.length===after.objects.length);
 for(const old of before.objects)assert.deepEqual(semantic(redo.objects.find(item=>item.id===old.id)),semantic(old));
 const recreated=redo.objects.filter(item=>!before.objects.some(old=>old.id===item.id));assert.equal(recreated.length,1);
 const comparable=object=>{const{id,orderKey,...rest}=semantic(object);return rest;};
 assert.deepEqual(comparable(recreated[0]),comparable(after.objects.find(item=>item.id===id)));
 // Structural redo may allocate a new identity under the existing core policy.
 await ctx.shot(actor,'S12-create-redo');return{state:redo,oldId:id,redoId:recreated[0].id};
}
export async function runStickyPersistence(ctx,actor,id,existingConnectorId){
 await leaveEditor(ctx,actor);const saved=await ctx.state(actor),note=saved.objects.find(item=>item.id===id),edge=saved.objects.find(item=>item.id===existingConnectorId);assert(note&&edge);
 assert(note.text.length>0&&note.extensionData.thinkingInput.sticky.color&&note.geometry.rotation!==0,'saved fixture must include text, nondefault appearance and actual transform');
 await ctx.assertRenderedNote(actor,id,note);await ctx.assertRenderedExistingEdge(actor,existingConnectorId,edge);await ctx.shot(actor,'S13-before-reload');
 await ctx.reloadActor(actor);const reloaded=await ctx.state(actor);assert.deepEqual(canonical(reloaded),canonical(saved));
 await ctx.assertRenderedNote(actor,id,note);await ctx.assertRenderedExistingEdge(actor,existingConnectorId,edge);await ctx.shot(actor,'S13-after-reload');
 return{case:'S13',id,existingConnectorId,head:{epoch:saved.head.epoch,seq:saved.head.seq},supportedCanonical:saved.objects};
}
