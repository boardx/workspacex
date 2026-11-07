import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,rmSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {chromiumLaunch} from './chromium-launch';
const require=createRequire(import.meta.url);
test('missing, relative, absent and nonexecutable paths refuse cache fallback',()=>{
 const root=mkdtempSync(join(tmpdir(),'cn-chromium-path-'));
 try{
  for(const path of [undefined,'relative/chrome'])assert.throws(()=>chromiumLaunch({},path),/EXPLICIT_INSTALLED_CHROMIUM_REQUIRED/);
  const file=join(root,'not-executable');writeFileSync(file,'fixture');chmodSync(file,0o600);
  for(const path of [join(root,'missing'),root,file])assert.throws(()=>chromiumLaunch({},path),/INSTALLED_CHROMIUM_NOT_EXECUTABLE/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('installed browser binding preserves microphone options without mutating base',()=>{
 const base={args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],timeout:5000};
 assert.deepEqual(chromiumLaunch(base,process.execPath),{...base,executablePath:process.execPath});
 assert.equal('executablePath'in base,false);
});
test('actual Playwright launch uses explicit executable under private HOME; synthetic shell is not a browser',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cn-chromium-launch-'));const script=join(root,'synthetic-browser'),marker=join(root,'invoked');
 try{
  const quote=(v:string)=>"'"+v.replace(/'/g,"'\"'\"'")+"'";
  writeFileSync(script,'#!/bin/sh\nprintf invoked > '+quote(marker)+'\nexit 17\n');chmodSync(script,0o700);
  const {chromium}=require(require.resolve('playwright-core',{paths:[resolve('apps/web')]}));
  await assert.rejects(chromium.launch(chromiumLaunch({headless:true,timeout:5000,env:{...process.env,HOME:root}},script)));
  assert.equal(readFileSync(marker,'utf8'),'invoked');
 }finally{rmSync(root,{recursive:true,force:true});}
});
