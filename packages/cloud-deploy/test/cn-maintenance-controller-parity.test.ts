import {expect,it} from 'vitest';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
it('rebuilds the installed controller from its canonical TS source with exact byte parity',async()=>{
 const compiler=createRequire(root+'apps/desktop/package.json')('esbuild');
 expect(compiler.version).toBe('0.24.2');
 const result=await compiler.build({absWorkingDir:root,entryPoints:['packages/cloud-deploy/src/cn-maintenance-host/entry.ts'],bundle:true,platform:'node',format:'cjs',target:'node22',minify:true,write:false,logLevel:'silent',banner:{js:'// Generated from packages/cloud-deploy/src/cn-maintenance-host/entry.ts. Source-bound tool artifact; READY=false.'}});
 expect(Buffer.from(result.outputFiles[0].contents).equals(readFileSync(root+'.harness/scripts/vm/cn-maintenance-host-controller.cjs'))).toBe(true);
});
