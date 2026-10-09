import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proveControlOnly } from './devapp-deploy-scope.mjs';

function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'devapp-scope-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 git(['init','-q']);git(['config','user.email','test@example.invalid']);git(['config','user.name','test']);
 const put=(path,text='x')=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),text);};
 const commit=()=>{git(['add','-A']);git(['commit','-qm','fixture']);return git(['rev-parse','HEAD']).trim();};
 put('baseline');const before=commit();
 return {git,put,commit,before,root,prove(sha,delta={}){return proveControlOnly({eventName:'push',ref:'refs/heads/main',sha,event:{before,after:sha,ref:'refs/heads/main'},git,...delta});}};
}
test('exact regular control change may skip',t=>{const f=fixture(t);f.put('scripts/cn_image_archive.py');assert.equal(f.prove(f.commit()).skip,true);});
for(const path of ['apps/api/src/main.ts','packages/cloud-deploy/src/cn-fast-safe-release.ts','pnpm-lock.yaml','control-runtime/package.json','scripts/unknown.py','.github/workflows/backend-gates.yml','.harness/scripts/devapp-deploy-scope.mjs','scripts/cn_image_archive.py\nother','scripts/cn_іmage_archive.py']) {
 test(`unknown/application/dependency/policy path retains deploy: ${JSON.stringify(path)}`,t=>{const f=fixture(t);f.put('scripts/cn_image_archive.py');f.put(path);assert.equal(f.prove(f.commit()).skip,false);});
}
test('missing baseline, forced event, checkout mismatch and non-main events retain deploy',t=>{
 const f=fixture(t);f.put('scripts/cn_image_archive.py');const sha=f.commit();
 for(const delta of [{eventName:'workflow_dispatch'},{eventName:'merge_group'},{ref:'refs/tags/v1'},{event:{before:'f'.repeat(40),after:sha,ref:'refs/heads/main'}},{event:{before:f.before,after:sha,ref:'refs/heads/main',forced:true}},{sha:'a'.repeat(40)},{git:()=>{throw Error('broken');}}]) assert.equal(f.prove(sha,delta).skip,false);
 assert.equal(f.prove(f.before).skip,false);
});
test('deletion and rename retain deploy',t=>{const f=fixture(t);f.put('scripts/cn_image_archive.py');const before=f.commit();rmSync(join(f.root,'scripts/cn_image_archive.py'));f.put('scripts/export-cn-image-archives.py');const sha=f.commit();assert.equal(f.prove(sha,{event:{before,after:sha,ref:'refs/heads/main'}}).skip,false);});
test('symlink on allowlisted name retains deploy',t=>{const f=fixture(t);f.git(['config','core.symlinks','true']);f.git(['update-index','--add','--cacheinfo','120000',f.git(['hash-object','-w','baseline']).trim(),'scripts/cn_image_archive.py']);f.git(['commit','-qm','symlink']);const sha=f.git(['rev-parse','HEAD']).trim();assert.equal(f.prove(sha).skip,false);});
test('executable bit transition retains deploy',t=>{const f=fixture(t);f.put('scripts/cn_image_archive.py');const before=f.commit();f.git(['update-index','--chmod=+x','scripts/cn_image_archive.py']);f.git(['commit','-qm','mode']);const sha=f.git(['rev-parse','HEAD']).trim();assert.equal(f.prove(sha,{event:{before,after:sha,ref:'refs/heads/main'}}).skip,false);});
