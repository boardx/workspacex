import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {listRuntimeSourceFiles,assertRuntimeSourceFiles,verifyRuntimeManifest} from './runtime-attestation.mjs';

test('tracked runtime closure rejects missing, extra, duplicate and omitted producer source',()=>{
 const root=mkdtempSync(join(tmpdir(),'wsx-native-closure-'));
 try{
  execFileSync('git',['init','--quiet'],{cwd:root});
  const runtime=['apps/api/src/main.ts','apps/web/lib/provider.ts','packages/core/index.ts','package.json','pnpm-lock.yaml','apps/web/e2e/support/native-runtime/wsx-board-native-runtime-start.mjs'];
  for(const path of [...runtime,'docs/unrelated.md']){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),'fixture');}
  execFileSync('git',['add','.'],{cwd:root});
  const expected=[...runtime].sort();assert.deepEqual(listRuntimeSourceFiles(root),expected);assert.doesNotThrow(()=>assertRuntimeSourceFiles(root,runtime));
  for(const sourceFiles of [runtime.slice(1),[...runtime,'docs/unrelated.md'],[...runtime,runtime[0]],runtime.filter(path=>!path.includes('native-runtime'))])assert.throws(()=>assertRuntimeSourceFiles(root,sourceFiles));
  const manifestPath=join(root,'private-manifest.json');
  for(const sourceFiles of [runtime.slice(1),[...runtime,'docs/unrelated.md'],[...runtime,runtime[0]]]){
   writeFileSync(manifestPath,JSON.stringify({sourceFiles,sourceHashes:Object.fromEntries(runtime.map(path=>[path,'a'.repeat(64)]))}),{mode:0o600});
   assert.throws(()=>verifyRuntimeManifest({manifestPath,root,base:'http://127.0.0.1:36317',origin:'http://127.0.0.1:36320',sourceFiles:runtime}),error=>error.code==='IDENTITY_SOURCE'&&/startup manifest|duplicate startup/.test(error.cause?.message));
  }
  writeFileSync(manifestPath,JSON.stringify({sourceFiles:runtime,sourceHashes:Object.fromEntries(runtime.slice(1).map(path=>[path,'a'.repeat(64)]))}),{mode:0o600});
  assert.throws(()=>verifyRuntimeManifest({manifestPath,root,base:'http://127.0.0.1:36317',origin:'http://127.0.0.1:36320',sourceFiles:runtime}),error=>error.code==='IDENTITY_SOURCE'&&/startup source hashes/.test(error.cause?.message));
 }finally{rmSync(root,{recursive:true});}
});
