import assert from 'node:assert/strict';
import test from 'node:test';
import {withImageOwnedCleanup} from '../../apps/web/e2e/support/board-image-owned-cleanup.ts';
test('first close rejection preserves primary and still attempts fixture, peer and archive',async()=>{
 const attempted:string[]=[],primary=new Error('runtime identity initialization failed'),close=new Error('first close failed');
 await assert.rejects(withImageOwnedCleanup(async own=>{
  own(()=>{attempted.push('context');throw close;});
  own(async()=>{attempted.push('fixture');});
  own(async()=>{attempted.push('peer');});
  own(async()=>{attempted.push('archive');});
  throw primary;
 }),error=>{assert(error instanceof AggregateError);assert.deepEqual(error.errors,[primary,close]);assert.equal(error.cause,primary);return true;});
 assert.deepEqual(attempted,['context','fixture','peer','archive']);
});
test('partial initialization releases only resources allocated and preserves exact failure',async()=>{
 const attempted:string[]=[],primary=new Error('newContext failed');
 await assert.rejects(withImageOwnedCleanup(async own=>{own(()=>{attempted.push('fixture');});throw primary;}),error=>error===primary);
 assert.deepEqual(attempted,['fixture']);
});
test('successful assertions still fail on cleanup, collecting every rejection',async()=>{
 const first=new Error('owner close'),second=new Error('archive failed');let peerClosed=false;
 await assert.rejects(withImageOwnedCleanup(async own=>{own(()=>{throw first;});own(()=>{peerClosed=true;});own(()=>{throw second;});}),error=>{assert(error instanceof AggregateError);assert.deepEqual(error.errors,[first,second]);return true;});
 assert(peerClosed);
});
