import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createStickyContextFoundation} from './wsx-r06-context-foundation.mjs';

function fixture({mismatch=false,status=200,moving=false,role='owner',seq=8}={}){
 const content=Buffer.from(JSON.stringify({board:{id:'owned-board',epoch:3,seq:8},objects:[{id:'sticky'}]}));
 const calls=[];let headCalls=0;
 const actor={page:{evaluate:async()=> 'actual-session',request:{fetch:async(url,options)=>{
  calls.push({url,options});let value;
  if(url.endsWith('/head')){headCalls++;value={epoch:3,seq:moving&&headCalls===1?7:seq,role};}
  else if(url.endsWith('/standard-export'))value={downloadPath:'/owned-download',epoch:3,seq:8,sizeBytes:content.length,sha256:mismatch?'bad':createHash('sha256').update(content).digest('hex')};
  else if(url.endsWith('/owned-download'))value={contentBase64:content.toString('base64')};
  else throw Error(`unexpected URL ${url}`);
  return{status:()=>status,ok:()=>status===200,json:async()=>value};
 }}}};
 return{calls,ctx:createStickyContextFoundation({origin:'https://api.invalid',owner:actor,boardId:'owned-board',scheduler:{run:operation=>operation()},colors:{yellow:'#FF0000'}})};
}
test('coherent canonical state validates real export metadata and bearer transport',async()=>{
 const{ctx,calls}=fixture();assert.deepEqual(await ctx.state(),{head:{epoch:3,seq:8,role:'owner'},objects:[{id:'sticky'}]});
 assert.equal(calls.length,4);assert(calls.every(call=>call.options.headers.authorization==='Bearer actual-session'));
});
test('unknown role and malformed actual sequence cannot stand in for authority',async()=>{
 await assert.rejects(fixture({role:'fake-owner'}).ctx.state(),/role must be explicit/);
 await assert.rejects(fixture({seq:NaN}).ctx.state(),/epoch\/sequence must be valid/);
});
test('head change causes complete coherent reread, not acceptance of mixed versions',async()=>{
 const{ctx,calls}=fixture({moving:true});assert.equal((await ctx.state()).head.seq,8);assert.equal(calls.length,8);
});
test('bad hash and 429 both fail, neither is hidden by retry',async()=>{
 const bad=fixture({mismatch:true});await assert.rejects(bad.ctx.state());assert.equal(bad.calls.length,3);
 const throttled=fixture({status:429});await assert.rejects(throttled.ctx.state(),/429 is a failure/);assert.equal(throttled.calls.length,1);
});
