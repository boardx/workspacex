import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertCancellationInputReceipt,assertZeroMutationTransport} from './wsx-r06-sticky-pointer-cancel.mjs';

const receipt=input=>({input,hardwareVerified:false,captureAcquired:true,events:[{type:'pointerdown',isTrusted:true,onTool:true},{type:input.includes('touch')?'pointercancel':'lostpointercapture',isTrusted:true,onTool:true}]});
test('trusted protocol cancellation remains distinct from hardware and synthetic events',()=>{
 const actual=receipt('browser-protocol-trusted-touch-cancel');assert.doesNotThrow(()=>assertCancellationInputReceipt(actual));
 assert.throws(()=>assertCancellationInputReceipt({...actual,hardwareVerified:true}));
 assert.throws(()=>assertCancellationInputReceipt({...actual,events:actual.events.map(event=>({...event,isTrusted:false}))}));
 assert.throws(()=>assertCancellationInputReceipt({...actual,events:actual.events.map(event=>({...event,onTool:false}))}));
});
test('zero mutation transport rejects late update, old invalid baseline and fake counters',()=>{
 const before={mutations:3,invalid:0};assert.doesNotThrow(()=>assertZeroMutationTransport(before,before));
 assert.throws(()=>assertZeroMutationTransport(before,{mutations:4,invalid:0}));
 assert.throws(()=>assertZeroMutationTransport({mutations:3,invalid:1},{mutations:3,invalid:1}));
 assert.throws(()=>assertZeroMutationTransport(before,{mutations:3,invalid:1}));
 assert.throws(()=>assertZeroMutationTransport(before,{mutations:NaN,invalid:0}));
});
test('release API coverage cannot pass without trusted capture-loss and acquired capture',()=>{
 const actual=receipt('browser-pointer-capture-api-release');assert.doesNotThrow(()=>assertCancellationInputReceipt(actual));
 assert.throws(()=>assertCancellationInputReceipt({...actual,captureAcquired:false}));
 assert.throws(()=>assertCancellationInputReceipt({...actual,events:actual.events.slice(0,1)}));
 assert.throws(()=>assertCancellationInputReceipt({...actual,input:'synthetic-dispatch'}));
});
