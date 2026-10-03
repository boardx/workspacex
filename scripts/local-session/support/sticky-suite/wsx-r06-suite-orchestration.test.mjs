import assert from 'node:assert/strict';
import test from 'node:test';
import {executeStickySuite,STICKY_CASE_IDS} from './wsx-r06-suite-orchestration.mjs';
test('all 18 slots execute and close even after actual case failure',async()=>{
 const executed=[],closed=[],recorded=[],executors=Object.fromEntries(STICKY_CASE_IDS.map(id=>[id,async()=>{executed.push(id);if(id==='S04')throw Error('native failure');return{case:id};}]));
 const result=await executeStickySuite({executors,createContext:async id=>({screenshots:[{path:'unit-only-mock'}],close:async()=>closed.push(id)}),recordCase:async value=>recorded.push(value.id)});
 assert.deepEqual(executed,STICKY_CASE_IDS);assert.deepEqual(closed,STICKY_CASE_IDS);assert.deepEqual(recorded,STICKY_CASE_IDS);assert.equal(result.requiredSuiteComplete,false);assert.equal(result.results[3].status,'fail');
});
test('optional callback absence, partial receipt and absent screenshots cannot pass',async()=>{
 const executors=Object.fromEntries(STICKY_CASE_IDS.map(id=>[id,async()=>id==='S05'?{case:id,requiredSuiteComplete:false}:{case:id}]));
 const result=await executeStickySuite({executors,createContext:async()=>({screenshots:[],close:async()=>{}}),recordCase:async()=>{}});
 assert.equal(result.requiredSuiteComplete,false);assert(result.results.every(value=>value.status==='fail'));
});
test('missing original slot fails before any browser lifecycle starts',async()=>{
 let started=false;await assert.rejects(executeStickySuite({executors:{S01:async()=>{}},createContext:async()=>{started=true;},recordCase:async()=>{}}));assert.equal(started,false);
});
