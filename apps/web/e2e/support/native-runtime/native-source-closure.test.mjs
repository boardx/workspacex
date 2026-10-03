import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {listRuntimeSourceFiles,assertRuntimeSourceFiles,verifyRuntimeManifest,runtimeSourceHashes,committedRuntimeSourceHashes} from './runtime-attestation.mjs';
import {listRuntimeSourceFiles as soleListRuntimeSourceFiles} from '../../../../../scripts/local-session/board-runtime-source-files.mjs';

test('tracked runtime closure rejects missing, extra, duplicate and omitted producer source',()=>{
 const root=mkdtempSync(join(tmpdir(),'wsx-native-closure-'));
 try{
  execFileSync('git',['init','--quiet'],{cwd:root});
  const runtime=['apps/api/src/main.ts','apps/web/lib/provider.ts','packages/core/index.ts','package.json','pnpm-lock.yaml','.npmrc','scripts/local-session/board-runtime-source-files.mjs','scripts/local-session/board-acceptance-runtime.mjs','apps/web/e2e/support/native-runtime/wsx-board-native-runtime-start.mjs'];
  for(const path of [...runtime,'docs/unrelated.md']){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),'fixture');}
  execFileSync('git',['add','.'],{cwd:root});
  assert.equal(listRuntimeSourceFiles,soleListRuntimeSourceFiles);
  const expected=[...runtime].sort();assert.deepEqual(listRuntimeSourceFiles(root),expected);assert.doesNotThrow(()=>assertRuntimeSourceFiles(root,runtime));
  const manifestPath=join(root,'private-manifest.json');
  writeFileSync(manifestPath,'private fixture',{mode:0o600});assert.deepEqual(listRuntimeSourceFiles(root),expected);
  const missingPolicyInputs=['.npmrc','scripts/local-session/board-runtime-source-files.mjs','scripts/local-session/board-acceptance-runtime.mjs'].map(missing=>runtime.filter(path=>path!==missing));
  for(const sourceFiles of [runtime.slice(1),[...runtime,'docs/unrelated.md'],[...runtime,runtime[0]],runtime.filter(path=>!path.includes('native-runtime')),...missingPolicyInputs])assert.throws(()=>assertRuntimeSourceFiles(root,sourceFiles));
  for(const sourceFiles of [runtime.slice(1),[...runtime,'docs/unrelated.md'],[...runtime,runtime[0]]]){
   writeFileSync(manifestPath,JSON.stringify({sourceFiles,sourceHashes:Object.fromEntries(runtime.map(path=>[path,'a'.repeat(64)]))}),{mode:0o600});
   assert.throws(()=>verifyRuntimeManifest({manifestPath,root,base:'http://127.0.0.1:36317',origin:'http://127.0.0.1:36320',sourceFiles:runtime}),error=>error.code==='IDENTITY_SOURCE'&&/startup manifest|duplicate startup/.test(error.cause?.message));
  }
  writeFileSync(manifestPath,JSON.stringify({sourceFiles:runtime,sourceHashes:Object.fromEntries(runtime.slice(1).map(path=>[path,'a'.repeat(64)]))}),{mode:0o600});
  assert.throws(()=>verifyRuntimeManifest({manifestPath,root,base:'http://127.0.0.1:36317',origin:'http://127.0.0.1:36320',sourceFiles:runtime}),error=>error.code==='IDENTITY_SOURCE'&&/startup source hashes/.test(error.cause?.message));
 }finally{rmSync(root,{recursive:true});}
});

test('working bytes cannot replace the exact attested Git commit bytes',()=>{
 const root=mkdtempSync(join(tmpdir(),'wsx-native-committed-'));
 try{
  execFileSync('git',['init','--quiet'],{cwd:root});
  const path='apps/web/lib/provider.ts';mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),Buffer.from([0,1,2,255]));
  execFileSync('git',['add','.'],{cwd:root});
  execFileSync('git',['-c','user.name=Runtime Fixture','-c','user.email=runtime-fixture@example.invalid','commit','--quiet','-m','fixture'],{cwd:root});
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceFiles=listRuntimeSourceFiles(root);
  assert.deepEqual(runtimeSourceHashes(root,sourceFiles),committedRuntimeSourceHashes(root,head,sourceFiles));
  writeFileSync(join(root,path),Buffer.from([0,1,3,255]));
  assert.notDeepEqual(runtimeSourceHashes(root,sourceFiles),committedRuntimeSourceHashes(root,head,sourceFiles));
  const manifestPath=join(root,'private-manifest.json');
  writeFileSync(manifestPath,JSON.stringify({head,webRoot:root,apiRoot:root,webBase:'http://127.0.0.1:36317',apiBase:'http://127.0.0.1:36320',sourceFiles,sourceHashes:runtimeSourceHashes(root,sourceFiles)}),{mode:0o600});
  assert.throws(()=>verifyRuntimeManifest({manifestPath,root,base:'http://127.0.0.1:36317',origin:'http://127.0.0.1:36320',sourceFiles}),error=>error.code==='IDENTITY_SOURCE'&&/exact attested commit/.test(error.cause?.message));
  assert.deepEqual(listRuntimeSourceFiles(root),sourceFiles);
  const missing='scripts/local-session/new-runtime-helper.mjs';mkdirSync(dirname(join(root,missing)),{recursive:true});writeFileSync(join(root,missing),'new source');execFileSync('git',['add',missing],{cwd:root});
  assert.throws(()=>committedRuntimeSourceHashes(root,head,listRuntimeSourceFiles(root)),/must exist in attested commit/);
 }finally{rmSync(root,{recursive:true});}
});
