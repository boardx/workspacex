import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url));
function run(command:string,args:string[]){const result=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:90000});expect(result.error).toBeUndefined();expect(result.status,result.stdout+result.stderr).toBe(0);}
describe('CN maintenance source-only safety adapters',()=>{
 it('verifies committed tool bundles match reviewed TypeScript sources',()=>{run(process.execPath,[resolve(root,'.harness/scripts/build-cn-maintenance-controller.cjs'),'--check']);},30000);
 it('runs actual controller protocol and refusal fixtures without services',()=>{
  const directory=resolve(root,'packages/cloud-deploy/src/cn-maintenance-host');
  const names=readdirSync(directory).filter(n=>n.endsWith('_test.ts')).sort().map(n=>resolve(directory,n));
  run(process.execPath,['--import','tsx','--test',...names]);
 },60000);
 it('runs Python, Node and transaction fixtures without service startup',()=>{
  run('python3',['-B',resolve(root,'.harness/scripts/run-cn-maintenance-pure-tests.py')]);
 },90000);
});
