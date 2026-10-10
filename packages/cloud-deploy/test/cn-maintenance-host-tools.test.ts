import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {runLinuxHostFixture} from './cn-host-linux-runner';
const root=fileURLToPath(new URL('../../../',import.meta.url));
function run(command:string,args:string[],linux=false,timeoutMs=90000){
 const result=linux&&process.platform==='darwin'
  ?runLinuxHostFixture(root,command,args,timeoutMs)
  :spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:timeoutMs});
 const diagnostics=(result.stderr??'').split('\n').filter(line=>line.startsWith('[cn-pure]'));
 if(diagnostics.length)console.log(diagnostics.join('\n'));
 expect(result.error).toBeUndefined();expect(result.status,result.stdout+result.stderr).toBe(0);
}
describe('CN maintenance source-only safety adapters',()=>{
 it('proves supervisor deadline diagnostics and owned pidfd cleanup without services',()=>{
  run('python3',['-B',resolve(root,'.harness/scripts/test_cn_pure_supervisor.py')],true,15000);
 },process.platform==='darwin'?300000:15000);
 it('verifies committed tool bundles match reviewed TypeScript sources',()=>{run(process.execPath,[resolve(root,'.harness/scripts/build-cn-maintenance-controller.cjs'),'--check']);},30000);
 it('runs actual controller protocol and refusal fixtures without services',()=>{
  const directory=resolve(root,'packages/cloud-deploy/src/cn-maintenance-host');
  const names=readdirSync(directory).filter(n=>n.endsWith('_test.ts')).sort().map(n=>resolve(directory,n));
  run(process.execPath,['--import','tsx','--test',...names],true);
 },process.platform==='darwin'?300000:60000);
 it('runs Python, Node and transaction fixtures without service startup',()=>{
  run('python3',['-B',resolve(root,'.harness/scripts/run-cn-maintenance-pure-tests.py')],true);
 },process.platform==='darwin'?300000:90000);
});
