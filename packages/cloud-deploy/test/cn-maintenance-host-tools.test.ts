import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url));
function run(command:string,args:string[]){const result=spawnSync(command,args,{cwd:root,encoding:'utf8',timeout:30000});expect(result.error).toBeUndefined();expect(result.status,result.stdout+result.stderr).toBe(0);}
describe('CN maintenance source-only safety adapters',()=>{
 it('runs actual controller protocol and refusal fixtures without services',()=>{
  const names=['actions','controller','entry','production_factory','recovery_audit','typed_operations'].map(n=>resolve(root,'packages/cloud-deploy/src/cn-maintenance-host/'+n+'_test.ts'));
  run(process.execPath,['--import','tsx','--test',...names]);
 },30000);
 it('runs Python, Node and transaction fixtures without service startup',()=>{
  run('python3',['-B',resolve(root,'.harness/scripts/run-cn-maintenance-pure-tests.py')]);
 },30000);
});
