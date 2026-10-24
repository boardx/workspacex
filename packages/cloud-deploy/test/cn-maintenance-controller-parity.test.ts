import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
it('checks all installed bundles with the canonical source generator',()=>{
 const result=spawnSync(process.execPath,['.harness/scripts/build-cn-maintenance-controller.cjs','--check'],{cwd:root,encoding:'utf8',timeout:30000});
 expect(result.status,result.stdout+result.stderr).toBe(0);
});
