import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FaultPolicy,fixedUpstream,scopedSession,sha256,validateScope} from './wsx-r08-proxy-policy.mjs';
import {createFaultProxy} from './wsx-r08-fault-proxy.mjs';
const boardId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',scope={boardId,sessionHashes:[sha256('one'),sha256('two')]};
const request=(token='one',url=`/v1/whiteboards/${boardId}/sync`)=>({url,headers:{'sec-websocket-protocol':`whiteboard,bearer.${token}`}});
test('canonical API upstream cannot be overridden to arbitrary remote target',()=>{
  assert.equal(fixedUpstream({prepared:true,ports:{api:36320},apiBase:'https://evil.invalid'}),'http://127.0.0.1:36320');
  for(const port of [0,80,65536,'36320'])assert.throws(()=>fixedUpstream({prepared:true,ports:{api:port}}));
  assert.throws(()=>fixedUpstream({prepared:false,ports:{api:36320}}));
});
test('only exact owned board and registered subprotocol sessions are controlled',()=>{
  assert.equal(scopedSession(request(),scope,'bearer.'),scope.sessionHashes[0]);
  assert.equal(scopedSession(request('two'),scope,'bearer.'),scope.sessionHashes[1]);
  for(const requestValue of [request('foreign'),request('one',`/v1/whiteboards/${boardId}/sync?token=one`),request('one','/v1/whiteboards/bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb/sync'),{...request(),headers:{'sec-websocket-protocol':'bearer.one,bearer.two'}}])assert.equal(scopedSession(requestValue,scope,'bearer.'),null);
});
test('invalid scope cannot acquire blanket authority',()=>{
  for(const value of [{...scope,boardId:'*'},{...scope,sessionHashes:[]},{...scope,sessionHashes:[scope.sessionHashes[0],scope.sessionHashes[0]]}])assert.throws(()=>validateScope(value));
});
test('exactly one real upgrade attempt is denied then restoration permits upgrades',()=>{
  const policy=new FaultPolicy(scope);policy.arm();
  assert.equal(policy.upgrade(scope.sessionHashes[0],'a'),503);
  assert.equal(policy.upgrade(scope.sessionHashes[1],'b'),101);
  assert.throws(()=>policy.arm());assert.throws(()=>policy.upgrade(sha256('foreign'),'c'));
  const receipt=policy.receipt();assert.equal(receipt.deniedUpgradeCount,1);
  assert.deepEqual(receipt.requests.map(value=>value.status),[503,101]);
  assert.ok(!JSON.stringify(receipt).includes(boardId));assert.ok(!JSON.stringify(receipt).includes('bearer.'));
});
test('passing an upstream URL directly still cannot acquire remote forwarding authority',()=>{
  const config={scope,controlSecret:'x'.repeat(32),bearerPrefix:'bearer.',port:36325,canonicalManifestSha256:'a'.repeat(64)};
  for(const upstream of ['https://example.com','http://localhost:36320','http://127.0.0.1:36320/path','http://u:p@127.0.0.1:36320','http://127.0.0.1:36320/?x=1'])assert.throws(()=>createFaultProxy({...config,upstream}));
  assert.throws(()=>createFaultProxy({...config,upstream:'http://127.0.0.1:36320',canonicalManifestSha256:undefined}));
});
test('confirmation cannot record a speculative success before a real 101',()=>{
  const policy=new FaultPolicy(scope);
  assert.equal(policy.authorizeAttempt(scope.sessionHashes[0],'a'),true);
  assert.equal(policy.receipt().requests.length,0);
  assert.throws(()=>policy.confirmUpgrade(scope.sessionHashes[0],'a',503));
  policy.confirmUpgrade(scope.sessionHashes[0],'a',101);
  assert.equal(policy.receipt().requests[0].status,101);
});
test('bounded receipts mark incompleteness instead of silently appearing green',()=>{
  const policy=new FaultPolicy(scope);
  for(let index=0;index<130;index++)policy.record({connectionId:String(index),event:'closed',sessionSha256:scope.sessionHashes[0]});
  assert.equal(policy.receipt().complete,false);assert.equal(policy.receipt().dropped,2);assert.equal(policy.receipt().requests.length,128);
});
test('restoring an armed fault does not fabricate a successful reconnect receipt',()=>{
  const policy=new FaultPolicy(scope);policy.arm();policy.restore();
  assert.equal(policy.authorizeAttempt(scope.sessionHashes[0],'restored'),true);
  assert.equal(policy.receipt().deniedUpgradeCount,0);
  assert.deepEqual(policy.receipt().requests,[]);
  policy.confirmUpgrade(scope.sessionHashes[0],'restored',101);
  assert.deepEqual(policy.receipt().requests.map(value=>value.status),[101]);
});
test('unstarted proxy can be disposed repeatedly without starting any listener',async()=>{
  const proxy=createFaultProxy({upstream:'http://127.0.0.1:36320',scope,controlSecret:'x'.repeat(32),bearerPrefix:'bearer.',port:36325,canonicalManifestSha256:'a'.repeat(64)});
  await proxy.dispose();await proxy.dispose();await assert.rejects(proxy.start(),/LIFECYCLE/);
});
