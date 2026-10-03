import assert from 'node:assert/strict';
import {rotatedPoint} from './wsx-r06-sticky-oracles.mjs';
const canonical=state=>({epoch:state.head.epoch,seq:state.head.seq,objects:state.objects});
const getNote=(state,id)=>{const note=state.objects.find(item=>item.id===id);assert(note);return note;};
const screen=(geometry,view)=>{const p=rotatedPoint(geometry,{x:geometry.width/2,y:geometry.height/2});return{x:view.x+view.panX+p.x*view.zoom,y:view.y+view.panY+p.y*view.zoom};};
async function dragHeld(ctx,actor,id){
 const before=await ctx.state(actor),point=screen(getNote(before,id).geometry,await ctx.view(actor));
 await actor.page.getByTestId('board-tool-select').click();await actor.page.mouse.move(point.x,point.y);await actor.page.mouse.down();await actor.page.mouse.move(point.x+41,point.y+29,{steps:12});
 assert.deepEqual(canonical(await ctx.state(actor)),canonical(before));return{before,point};
}
export async function runStickyViewerDenials(ctx,owner,viewer,id){
 assert.equal((await ctx.state(viewer)).head.role,'viewer');assert.notEqual(owner.identity.userId,viewer.identity.userId);
 const before=await ctx.state(owner),note=getNote(before,id),point=screen(note.geometry,await ctx.view(viewer)),attempts=[];
 const observe=request=>{if(request.method()==='POST'&&/\/whiteboards\/[^/]+\/(?:commands|operations)(?:\?|$)/.test(request.url()))attempts.push({method:request.method(),path:new URL(request.url()).pathname});};
 viewer.page.on('request',observe);
 try{
  assert(await viewer.page.getByTestId('board-add-sticky').isDisabled());
  for(const key of ['n','t','s']){await viewer.page.keyboard.press(key);await viewer.page.mouse.click(point.x+230,point.y+40);}
  await viewer.page.mouse.dblclick(point.x,point.y);assert.equal(await viewer.page.getByTestId('board-thinking-editor').count(),0);
  await dragHeld(ctx,viewer,id);await viewer.page.mouse.up();
  await ctx.assertReadOnlyTransformControls(viewer,id);assert.deepEqual(canonical(await ctx.state(owner)),canonical(before));
  assert.deepEqual(attempts,[],'readonly UI must not dispatch a late mutation');
 }finally{viewer.page.off('request',observe);}
 const request=await ctx.validatedOperation(viewer,[{type:'geometry',id,geometry:{...note.geometry,x:note.geometry.x+31}}]);
 const response=await ctx.sendOperation(viewer,request);assert.equal(response.status(),403,'exact valid viewer operation denial required');
 assert.deepEqual(canonical(await ctx.state(owner)),canonical(before));await ctx.shot(viewer,'S15-viewer-denied');
 await ctx.assertReadOnlyFullText(viewer,id,note.text);
 return{case:'S15',viewerId:viewer.identity.userId,apiStatus:403,uiMutationRequests:attempts.length,canonical:canonical(before)};
}
export async function runStickyLockedAndAuthorityRaces(ctx,owner,peer){
 const receipts=[];
 for(const mode of ['peer-lock','peer-delete','permission-revoke']){
  const id=await ctx.createStickyNative(owner,'rectangle','blue');await ctx.waitRendered(peer,id);
  const actor=mode==='permission-revoke'?peer:owner,{before,point}=await dragHeld(ctx,actor,id);
  // Peer policy/lifecycle mutations are explicit fixtures, never counted as Sticky creation.
  if(mode==='peer-lock')await ctx.fixtureOperation(peer,[{type:'state',id,locked:true}]);
  else if(mode==='peer-delete')await ctx.fixtureOperation(peer,[{type:'delete',id}]);
  else await ctx.setBoardMember(owner,peer.identity.userId,'viewer');
  const authoritative=await ctx.state(owner);
  if(mode==='permission-revoke')assert.equal((await ctx.state(peer)).head.role,'viewer');
  else assert.equal(authoritative.head.seq,before.head.seq+1,'one exact policy fixture transaction required');
  await actor.page.mouse.up();await actor.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.deepEqual(canonical(await ctx.state(owner)),canonical(authoritative),'stale held gesture must not overwrite latest authority or resurrect deleted note');
  await ctx.shot(actor,`S16-${mode}-released`);
  if(mode==='peer-lock'){
   await actor.page.mouse.dblclick(point.x,point.y);assert.equal(await actor.page.getByTestId('board-thinking-editor').count(),0);
   await dragHeld(ctx,actor,id);await actor.page.mouse.up();assert.deepEqual(canonical(await ctx.state(owner)),canonical(authoritative));
   await ctx.fixtureOperation(peer,[{type:'state',id,locked:false}]);
  }
  if(mode==='permission-revoke')await ctx.setBoardMember(owner,peer.identity.userId,'editor');
  await ctx.reloadActor(actor);const recovered=await ctx.createStickyNative(actor,'circle','pink');assert(recovered);
  receipts.push({mode,id,recoveredId:recovered,latestSeq:authoritative.head.seq});
 }
 return{case:'S16',receipts};
}
