import assert from 'node:assert/strict';
import test from 'node:test';
import {createOwnedStickyBoardLifecycle} from './wsx-r06-owned-board-lifecycle.mjs';
function fixture(){
 const events=[],receipts=[];let name,ownerId='actual-owner',changedTitle=false,failRead=false,failReceipt=false;
 const actor={identity:{userId:'actual-owner'},page:{goto:async()=>events.push('goto')},close:async()=>events.push('close')};
 const ctx={api:async(a,method,path,body)=>{
  if(method==='POST'){name=body.name;return{id:'created-board',ownerId};}
  events.push({method,path,body});if(failRead)throw Error('READ_FAILED');
  return{name:changedTitle?'different-title':name,ownerId,archived:false,lifecycleRevision:9};
 },surface:()=>({waitFor:async()=>{}}),state:async()=>({head:{role:'owner'},objects:[]}),request:async(a,method,path,body,status)=>{
  events.push({method,path,body,status});
 }};
 const lifecycle=createOwnedStickyBoardLifecycle({ctx,base:'https://web.invalid',launchOwner:async()=>actor,onReceipt:async receipt=>{if(failReceipt)throw Error('WRITE_FAILED');receipts.push({...receipt});}});
 return{actor,events,receipts,lifecycle,changeOwner:()=>{ownerId='different-owner';},changeTitle:()=>{changedTitle=true;},failRead:()=>{failRead=true;},failReceipt:()=>{failReceipt=true;}};
}
test('tracked fresh boards preserve with owner/title receipts and browser closes without writes',async()=>{
 const f=fixture(),actor=await f.lifecycle.launchFreshOwner({});assert.deepEqual(f.lifecycle.trackedBoards(),['created-board']);
 await f.lifecycle.cleanupFreshOwner(actor);assert.deepEqual(f.lifecycle.trackedBoards(),['created-board']);
 assert(f.receipts.length===3);assert.equal(f.receipts[0].titleVerified,false);assert.equal(f.receipts.at(-1).titleVerified,true);assert.equal(f.receipts.at(-1).ownerVerified,true);
 assert(f.receipts.every(receipt=>receipt.deleted===false&&receipt.cleanupPending===true&&receipt.pendingPermanentDelete===true));
 assert(f.events.filter(event=>typeof event==='object').every(event=>event.method==='GET'));assert.equal(f.events.at(-1),'close');
});
test('untracked existing board cannot be archived, browser still closes',async()=>{
 const f=fixture();f.actor.boardId='existing-board';await assert.rejects(f.lifecycle.cleanupFreshOwner(f.actor));
 assert(!f.events.some(event=>event.method==='PATCH'));assert.equal(f.events.at(-1),'close');
});
test('changed ownership rejects cleanup writes and retains receipt for recovery',async()=>{
 const f=fixture(),actor=await f.lifecycle.launchFreshOwner({});f.changeOwner();await assert.rejects(f.lifecycle.cleanupFreshOwner(actor));
 assert(!f.events.some(event=>event.method==='PATCH'));assert.deepEqual(f.lifecycle.trackedBoards(),['created-board']);assert.equal(f.events.at(-1),'close');
});
test('changed title rejects readback and still closes the browser',async()=>{
 const f=fixture(),actor=await f.lifecycle.launchFreshOwner({});f.changeTitle();await assert.rejects(f.lifecycle.cleanupFreshOwner(actor));assert.equal(f.events.at(-1),'close');assert.equal(f.receipts.length,2);
});
test('failed readback preserves initial registry and closes the browser',async()=>{
 const f=fixture();f.failRead();await assert.rejects(f.lifecycle.launchFreshOwner({}));assert.deepEqual(f.lifecycle.trackedBoards(),['created-board']);assert.equal(f.receipts.length,1);assert.equal(f.events.at(-1),'close');
});
test('failed receipt writes never permit destructive cleanup or skip browser close',async()=>{
 const f=fixture();f.failReceipt();await assert.rejects(f.lifecycle.launchFreshOwner({}));assert.deepEqual(f.lifecycle.trackedBoards(),['created-board']);assert.equal(f.events.at(-1),'close');assert(!f.events.some(event=>event.method==='PATCH'||event.method==='DELETE'));
});
