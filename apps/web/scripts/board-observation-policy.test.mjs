import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRuntimeBinding,validateBoardObservationArtifact} from './board-observation-policy.mjs';
const sha='a'.repeat(40),context={runtimeMarker:'fresh',startedAt:'2026-09-27T00:00:00Z',endedAt:'2026-09-27T00:40:00Z'};
const identity={sha,buildSha:sha,dirty:false,method:'fresh-server-marker-and-built-chunk-hashes',deploymentMarker:'fresh',buildId:'id',runStartedAt:context.startedAt,buildCreatedAt:'2026-09-27T00:01:00Z',chunks:[{url:'/x.js',sha256:'b'.repeat(64),localSha256:'b'.repeat(64)}]};
test('runtime is bound to exact fresh run and built chunks',()=>{
 assert.deepEqual(validateRuntimeBinding(identity,sha,context),[]);
 for(const patch of [{deploymentMarker:'old'},{runStartedAt:'invalid'},{buildCreatedAt:'2026-09-28T00:00:00Z'},{dirty:true},{buildSha:'c'.repeat(40)},{chunks:[]}])assert.ok(validateRuntimeBinding({...identity,...patch},sha,context).length);
});
test('visual cannot substitute duplicate browsers or arbitrary success metadata',async()=>{
 for(const reports of [[],[{browserName:'chromium'},{browserName:'chromium'},{browserName:'webkit'}]]){
 const result=await validateBoardObservationArtifact({version:1,kind:'board-visual-accessibility-bundle',reports},'visual',sha,context);assert.equal(result.valid,false);assert.equal(result.score,null);
 }
});
test('unsigned or invalidly signed meeting room artifacts cannot be accepted',async()=>{
 for(const key of [undefined,'x'.repeat(32)]){
 const result=await validateBoardObservationArtifact({version:1,kind:'board-meeting-room',ledger:{signature:'0'.repeat(64)},runtimeBefore:identity,runtimeAfter:identity},'meeting-room',sha,context,key);assert.equal(result.valid,false);assert.equal(result.score,null);
 }
});
