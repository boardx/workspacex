import test from 'node:test';
import assert from 'node:assert/strict';
import {startGithubProtocolFixture} from './github-loopback';
test('GitHub boundary uses actual loopback HTTP and forbids remote/write fallback',async()=>{
 const f=await startGithubProtocolFixture();
 try{
  const url='https://api.github.com/repos/fixture-only/six-journey/issues/1';
  assert.deepEqual(await (await f.fetch(url)).json(),{state:'open',state_reason:null});
  assert.deepEqual(await (await f.fetch(url+'/timeline?per_page=100')).json(),[]);
  assert.equal(f.reads(),2);
  await assert.rejects(f.fetch(url,{method:'POST'}),/READ_SCOPE/);
  await assert.rejects(f.fetch(new Request(url,{method:'POST'})),/READ_SCOPE/);
  await assert.rejects(f.fetch('https://api.github.com/repos/boardx/workspacex/issues/1'),/READ_SCOPE/);
  await assert.rejects(f.fetch('https://example.com/'),/EXTERNAL_FETCH_FORBIDDEN/);
  assert.equal(f.reads(),2);
 }finally{await f.close();}
});
