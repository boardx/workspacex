import assert from 'node:assert/strict';
const canonical=state=>({epoch:state.head.epoch,seq:state.head.seq,objects:state.objects});
export async function runStickyUnsentDraftConflict(ctx,owner,peer,id){
 assert.notEqual(owner.pid,peer.pid);assert.notEqual(owner.identity.userId,peer.identity.userId);
 const before=await ctx.state(owner);await ctx.activateEditorNative(owner,id);
 const input=owner.page.getByTestId('board-thinking-editor');await input.waitFor();
 await input.focus();await input.press('ControlOrMeta+A');await input.dispatchEvent('compositionstart',{data:''});
 const draft='Unsent local composing draft 中文\n末尾保留';await owner.page.keyboard.insertText(draft);assert.equal(await input.inputValue(),draft);
 assert.deepEqual(canonical(await ctx.state(owner)),canonical(before),'unsent composing draft is not canonical');
 const peerText='Peer真实用户提交\nCanonical remote value';await ctx.editNative(peer,id,peerText,'command');
 const peerSaved=await ctx.poll(()=>ctx.state(peer),state=>state.objects.find(note=>note.id===id)?.text===peerText);
 await ctx.poll(()=>ctx.state(owner),state=>JSON.stringify(canonical(state))===JSON.stringify(canonical(peerSaved)));
 assert.equal(await input.inputValue(),draft,'remote canonical arrival must not replace unsent local draft');await ctx.shot(owner,'S12-local-draft-preserved-before-conflict');
 await input.dispatchEvent('compositionend',{data:draft});
 const preserved=owner.page.getByRole('textbox',{name:'未应用的输入草稿'});await preserved.waitFor();assert.equal(await preserved.inputValue(),draft);
 assert.deepEqual(canonical(await ctx.state(owner)),canonical(peerSaved),'refused conflicting commit must not overwrite peer canonical');
 assert.deepEqual(canonical(await ctx.state(peer)),canonical(peerSaved));await ctx.shot(owner,'S12-conflict-preserved-draft');
 return{case:'S12',scope:'unsent draft/remote edit conflict',draft,peerText,sourcePolicy:'existing commitEdit compares current canonical text against editing.initial',nativeOSIME:'manual-required',head:{epoch:peerSaved.head.epoch,seq:peerSaved.head.seq}};
}
