import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rotatedPoint} from './wsx-r06-sticky-oracles.mjs';
const canonical=state=>({epoch:state.head.epoch,seq:state.head.seq,objects:state.objects});
const note=(state,id)=>{const value=state.objects.find(object=>object.id===id);assert(value);return value;};
export async function launchIndependentStickyActor({chromium,statePath,base,api,board,role,dpr=1,viewport={width:1440,height:900}}){
 const server=await chromium.launchServer();let browser,context;
 try{
 browser=await chromium.connect(server.wsEndpoint());
 context=await browser.newContext({storageState:JSON.parse(readFileSync(statePath,'utf8')),viewport,deviceScaleFactor:dpr});
 const page=await context.newPage();await page.goto(board?`${base}/studio/board/${board}`:`${base}/home`);if(board)await page.getByTestId('board-fabric-surface').waitFor();
 const token=await page.evaluate(()=>localStorage.getItem('wsx.sessionToken'));assert(token);
 const response=await page.request.get(api+'/kernel/probe/whoami',{headers:{authorization:`Bearer ${token}`}});assert(response.ok());
 const identity=await response.json();assert(identity.userId&&identity.orgId);
 const pid=server.process().pid;assert(Number.isInteger(pid)&&pid>0);process.kill(pid,0);
 return{server,browser,context,page,identity,role,pid,engineVersion:browser.version(),close:async()=>{
  const errors=[];for(const cleanup of [()=>context.close(),()=>browser.close(),()=>server.close()])try{await cleanup();}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(errors,'independent browser cleanup failed');
 }};
 }catch(error){await Promise.allSettled([context?.close(),browser?.close(),server.close()]);throw error;}
}
export async function runStickyTwoUserConvergence(ctx,a,b){
 assert.notEqual(a.pid,b.pid,'two contexts in one browser process are insufficient');
 assert.notEqual(a.identity.userId,b.identity.userId,'independent users must be genuinely authenticated');
 assert.equal(a.identity.orgId,b.identity.orgId);
 const first=await ctx.state(a),second=await ctx.state(b);assert.equal(first.head.role,'owner');assert.equal(second.head.role,'editor');
 assert.deepEqual(canonical(first),canonical(second));
 const id=await ctx.createStickyNative(a,'rectangle','blue'),created=await ctx.state(a);assert.equal(created.head.seq,first.head.seq+1);
 await ctx.poll(()=>ctx.state(b),state=>JSON.stringify(canonical(state))===JSON.stringify(canonical(created)));
 await ctx.assertRenderedNote(a,id,note(created,id));await ctx.assertRenderedNote(b,id,note(created,id));
 const textA='A 真实用户编辑\nIndependent owner text';await ctx.editNative(a,id,textA,'command');
 const editedA=await ctx.poll(()=>ctx.state(a),state=>note(state,id).text===textA);
 await ctx.poll(()=>ctx.state(b),state=>JSON.stringify(canonical(state))===JSON.stringify(canonical(editedA)));
 const view=await ctx.view(a),old=note(editedA,id),center=rotatedPoint(old.geometry,{x:old.geometry.width/2,y:old.geometry.height/2});
 const p={x:view.x+view.panX+center.x*view.zoom,y:view.y+view.panY+center.y*view.zoom};
 await a.page.getByTestId('board-tool-select').click();await a.page.mouse.move(p.x,p.y);await a.page.mouse.down();await a.page.mouse.move(p.x+31,p.y+27,{steps:12});
 assert.deepEqual(canonical(await ctx.state(a)),canonical(editedA));await a.page.mouse.up();
 const moved=await ctx.poll(()=>ctx.state(a),state=>state.head.seq===editedA.head.seq+1),next=note(moved,id);
 assert(Math.abs(next.geometry.x-old.geometry.x-31/view.zoom)<=.01);assert(Math.abs(next.geometry.y-old.geometry.y-27/view.zoom)<=.01);
 await ctx.poll(()=>ctx.state(b),state=>JSON.stringify(canonical(state))===JSON.stringify(canonical(moved)));
 const textB='B 不同真实用户继续编辑\nPeer edit preserved';await ctx.editNative(b,id,textB,'command');
 const editedB=await ctx.poll(()=>ctx.state(b),state=>note(state,id).text===textB);
 await ctx.poll(()=>ctx.state(a),state=>JSON.stringify(canonical(state))===JSON.stringify(canonical(editedB)));
 await ctx.assertRenderedNote(a,id,note(editedB,id));await ctx.assertRenderedNote(b,id,note(editedB,id));
 await ctx.shot(a,'S14-owner-converged');await ctx.shot(b,'S14-peer-converged');
 return{case:'S14',actors:[a,b].map(actor=>({userId:actor.identity.userId,pid:actor.pid,version:actor.engineVersion})),sameEngineProcesses:true,objectId:id,final:canonical(editedB)};
}
