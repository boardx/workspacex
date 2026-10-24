import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const helper=resolve('.github/scripts/cn-auto-source.mjs');
function fixture(fn){
 const root=mkdtempSync(join(tmpdir(),'cn-cloud-source-'));
 try{
  const repo=join(root,'repo'),bin=join(root,'bin'),output=join(root,'output');mkdirSync(repo);mkdirSync(bin);
  const git=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q','-b','main');git('config','user.email','test@example.invalid');git('config','user.name','test');
  git('commit','--allow-empty','-qm','baseline');const baseline=git('rev-parse','HEAD');
  git('commit','--allow-empty','-qm','candidate');const source=git('rev-parse','HEAD');
  git('commit','--allow-empty','-qm','new main');const main=git('rev-parse','HEAD');
  writeFileSync(join(bin,'gh'),`#!/usr/bin/env node
const a=process.argv.slice(2);
if(a[1].includes('/compare/'))console.log(process.env.COMPARE_STATUS||'ahead');
else if(a[1].endsWith('/main-cn')) {const fs=require('fs'),p=process.env.DESIRED_COUNTER;const n=fs.existsSync(p)?Number(fs.readFileSync(p)):0;fs.writeFileSync(p,String(n+1));console.log(n>0&&process.env.DESIRED_ON_SECOND_SHA||process.env.DESIRED_SHA);}
else if(a[1].endsWith('/main'))console.log(process.env.MAIN_SHA);
else process.exit(2);
`,{mode:0o700});
  const run=(env={})=>spawnSync(process.execPath,[helper],{cwd:repo,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,DESIRED_COUNTER:join(root,'desired-counter'),GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'boardx/workspacex',RELEASE_SHA:source,MAIN_SHA:main,DESIRED_SHA:source,GITHUB_SHA:main,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',SOURCE_OUTPUT_DIR:output,GITHUB_OUTPUT:join(root,'result'),...env}});
  fn({root,repo,git,output,baseline,source,main,run});
 } finally {rmSync(root,{recursive:true,force:true});}
}
test('real full bundle imports exact candidate and accepted ancestor with no source repository',()=>fixture(({root,output,baseline,source,run})=>{
 const r=run();assert.equal(r.status,0,r.stderr);const bundle=join(output,'source.bundle');
 const meta=JSON.parse(readFileSync(join(output,'source.json')));assert.equal(meta.sourceRevision,source);
 assert.equal(meta.bundleSha256,createHash('sha256').update(readFileSync(bundle)).digest('hex'));
 const checkout=join(root,'consumer');execFileSync('git',['init','--bare',checkout],{stdio:'ignore'});
 execFileSync('git',['-C',checkout,'bundle','verify',bundle],{stdio:'ignore'});
 execFileSync('git',['-C',checkout,'fetch',bundle,'refs/remotes/origin/main:refs/heads/main'],{stdio:'ignore'});
 const git=(...a)=>execFileSync('git',['-C',checkout,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 assert.equal(git('rev-parse','refs/heads/main'),source);
 git('cat-file','-e',baseline+'^{commit}');git('merge-base','--is-ancestor',baseline,source);git('fsck','--full');
 assert.equal(git('rev-parse','--is-shallow-repository'),'false');assert.match(r.stdout,/not production admission/);
}));
test('stale desired and source outside current main never publish metadata',()=>fixture(({output,baseline,run})=>{
 for(const env of [{DESIRED_SHA:baseline},{COMPARE_STATUS:'diverged'},{COMPARE_STATUS:'behind'}]){
  const r=run(env);assert.notEqual(r.status,0);assert.equal(existsSync(join(output,'source.json')),false);
 }
}));
test('desired moving during bundle production prevents metadata and digest publication',()=>fixture(({root,output,baseline,run})=>{
 const r=run({DESIRED_ON_SECOND_SHA:baseline});assert.notEqual(r.status,0);
 assert.equal(existsSync(join(output,'source.json')),false);assert.equal(existsSync(join(root,'result')),false);
}));
test('real local ancestry is required even if remote compare claims source is allowed',()=>fixture(({output,baseline,run})=>{
 const r=run({MAIN_SHA:baseline});assert.notEqual(r.status,0);assert.equal(existsSync(join(output,'source.json')),false);
}));
test('rejects partial, borrowed and shallow source before any artifact',()=>fixture(({repo,git,source,output,run})=>{
 git('config','remote.origin.promisor','true');assert.notEqual(run().status,0);git('config','--unset','remote.origin.promisor');
 writeFileSync(join(repo,'.git/objects/info/alternates'),'/untrusted\n');assert.notEqual(run().status,0);rmSync(join(repo,'.git/objects/info/alternates'));
 writeFileSync(join(repo,'.git/shallow'),source+'\n');assert.notEqual(run().status,0);
 assert.equal(existsSync(join(output,'source.json')),false);
}));
test('untrusted workflow context cannot produce artifacts',()=>fixture(({output,run})=>{
 for(const env of [{GITHUB_EVENT_NAME:'push'},{GITHUB_REF:'refs/heads/develop'},{RELEASE_SHA:'main'}])assert.notEqual(run(env).status,0);
 assert.equal(existsSync(join(output,'source.json')),false);
}));
test('workflow transports cloud source outside checkout then streams to the narrow fixed root entry',()=>{
 const w=readFileSync('.github/workflows/prepare-cn-release.yml','utf8');
 assert.match(w,/source-bundle:[\s\S]*?runs-on: ubuntu-latest/);
 assert.match(w,/fetch-depth: 0/);assert.match(w,/persist-credentials: false/);
 assert.match(w,/needs: \[source-bundle, candidate-ci, devapp-exact-evidence\]/);assert.match(w,/needs.source-bundle.result == 'success'/);
 assert.match(w,/!inputs.auto_promote && needs.source-bundle.result == 'skipped'/);
 assert.match(w,/--auto-stage-source "\$REVISION" "gha-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}" "\$BUNDLE_SHA256" < "\$SOURCE_DIRECTORY\/source.bundle"/);
 assert.match(w,/path: \$\{\{ runner.temp \}\}\/cn-auto-source-/);
 assert.ok(w.indexOf('--auto-stage-source')<w.indexOf('workspacex-cn-export-source'));
 assert.match(w,/workspacex-cn-deploy --check-prepare-inputs/);
});
