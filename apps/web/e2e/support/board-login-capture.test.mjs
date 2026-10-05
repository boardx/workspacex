import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureBoardLogin} from './board-login-capture.mjs';

function fixture({fetchError, unrouteError, parseError, posts=1}={}) {
  const events=[];
  let handler;
  const upstream={status:()=>200,json:async()=>{events.push('read');if(parseError)throw parseError;return {userId:'actor',sessionToken:'secret'};}};
  const page={route:async(_,value)=>{handler=value;},unroute:async()=>{events.push('unroute');if(unrouteError)throw unrouteError;}};
  const login=async()=>{
    for(let index=0;index<posts;index++)await handler({request:()=>({method:()=> 'POST'}),fetch:async()=>{if(fetchError)throw fetchError;return upstream;},fulfill:async({response})=>{assert.equal(response,upstream);events.push('fulfill');},abort:async()=>{events.push('abort');}});
    events.push('navigate');return 'secret';
  };
  return {page,login,events};
}
test('reads the single real login before response release and full navigation; retains upstream response',async()=>{
  const f=fixture();assert.deepEqual(await captureBoardLogin(f.page,f.login),{status:200,body:{userId:'actor',sessionToken:'secret'},jsonParsed:true,token:'secret',posts:1});
  assert.deepEqual(f.events,['read','fulfill','navigate','unroute']);
});
test('fetch and cleanup rejection remain handled in primary-first order',async()=>{
 const first=new Error('upstream'),last=new Error('cleanup'),f=fixture({fetchError:first,unrouteError:last});
 await assert.rejects(captureBoardLogin(f.page,f.login),error=>{assert.deepEqual(error.errors,[first,last]);return true;});
 assert.deepEqual(f.events,['abort','navigate','unroute']);
});
test('JSON parse failure remains a schema diagnostic and does not rewrite upstream',async()=>{
 const f=fixture({parseError:new Error('invalid JSON')});const result=await captureBoardLogin(f.page,f.login);assert.equal(result.jsonParsed,false);assert.equal(result.status,200);assert.equal(result.body,undefined);assert(f.events.includes('fulfill'));
});
test('missing and duplicate real POSTs fail the single login criterion',async()=>{
 for(const posts of [0,2]){const f=fixture({posts});await assert.rejects(captureBoardLogin(f.page,f.login),/SINGLE_POST_REQUIRED/);assert.equal(f.events.at(-1),'unroute');}
});
test('cleanup drains a login handler that outlives a rejected navigation',async()=>{
 let handler, release, settled=false;
 const gate=new Promise(resolve=>{release=resolve;});
 const first=new Error('navigation'),late=new Error('upstream');
 const page={route:async(_,value)=>{handler=value;},unroute:async()=>{}};
 const result=captureBoardLogin(page,async()=>{handler({request:()=>({method:()=> 'POST'}),fetch:async()=>{await gate;throw late;},abort:async()=>{}});throw first;});
 result.then(()=>{settled=true;},()=>{settled=true;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);release();
 await assert.rejects(result,error=>{assert.deepEqual(error.errors,[first,late]);return true;});
});
test('non-POST continue rejection is handled and drained without covering login error',async()=>{
 let handler;
 const first=new Error('navigation'),secondary=new Error('continue');
 const page={route:async(_,value)=>{handler=value;},unroute:async()=>{}};
 await assert.rejects(captureBoardLogin(page,async()=>{handler({request:()=>({method:()=> 'GET'}),continue:async()=>{await new Promise(resolve=>setImmediate(resolve));throw secondary;},abort:async()=>{}});throw first;}),error=>{assert.deepEqual(error.errors,[first,secondary]);return true;});
});
