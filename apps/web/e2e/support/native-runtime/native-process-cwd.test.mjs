import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeProcessCwd} from './runtime-attestation.mjs';

test('Linux reads the exact managed PID kernel cwd without lsof or guessed root',()=>{
  let observed;
  const actual=runtimeProcessCwd(123,{platform:'linux',readlink:path=>{observed=path;return '/physical/candidate/apps/web';},exec:()=>assert.fail('Linux must use kernel cwd')});
  assert.equal(observed,'/proc/123/cwd');assert.equal(actual,'/physical/candidate/apps/web');
});
test('missing or forbidden kernel cwd retains its original failure and never falls back',()=>{
  for(const code of ['ENOENT','EACCES','EPERM']){
    const error=Object.assign(new Error('private kernel failure'),{code});
    assert.throws(()=>runtimeProcessCwd(123,{platform:'linux',readlink:()=>{throw error;},exec:()=>assert.fail('No fallback')}),actual=>actual===error);
  }
  for(const pid of [0,-1,NaN,1.5,'123'])assert.throws(()=>runtimeProcessCwd(pid,{platform:'linux',readlink:()=>assert.fail('Invalid PID must not read kernel cwd')}));
});
test('Mac retains the original lsof arguments and cwd field decoding',()=>{
  let observed;
  const actual=runtimeProcessCwd(456,{platform:'darwin',readlink:()=>assert.fail('Mac must retain lsof'),exec:(command,args,options)=>{observed={command,args,options};return 'p456\nn/physical/candidate/apps/web\n';}});
  assert.equal(actual,'/physical/candidate/apps/web');
  assert.deepEqual(observed,{command:'lsof',args:['-a','-p','456','-d','cwd','-Fn'],options:{encoding:'utf8'}});
});
