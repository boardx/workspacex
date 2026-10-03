import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const source=readFileSync(new URL('./stage-cn-offline-source-cache.sh',import.meta.url),'utf8');
function fixture(fn){const root=mkdtempSync(join(tmpdir(),'cn-domestic-'));try{const repo=join(root,'git');mkdirSync(repo);const git=(...args)=>{const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};git('init');git('-c','user.name=t','-c','user.email=t@example.invalid','commit','--allow-empty','-m','baseline');const baseline=git('rev-parse','HEAD');git('-c','user.name=t','-c','user.email=t@example.invalid','commit','--allow-empty','-m','candidate');const candidate=git('rev-parse','HEAD');git('branch','-M','main');git('branch','main-cn',baseline);const cache=join(root,'cache.git');assert.equal(spawnSync('git',['clone','--bare','--no-local',repo,cache]).status,0);chmodSync(cache,0o700);git('remote','add','origin',cache);git('update-ref','refs/remotes/origin/main-cn',baseline);
const bin=join(root,'bin');mkdirSync(bin);writeFileSync(join(bin,'stat'),'#!/bin/sh\necho root:root:700\n');chmodSync(join(bin,'stat'),0o700);writeFileSync(join(bin,'flock'),'#!/bin/sh\n[ -z "$TEST_LOCK_BUSY" ]\n');chmodSync(join(bin,'flock'),0o700);writeFileSync(join(bin,'install'),'#!/bin/sh\nfor v in "$@"; do case "$v" in /*) mkdir -p "$v";; esac; done\n');chmodSync(join(bin,'install'),0o700);
const script=join(root,'stage.sh');writeFileSync(script,source.replace('[[ ${EUID} -eq 0 ]] || exit 1','true # only root identity mocked; no actual production execution').replace('root_cache=/var/lib/workspacex-cn/source-cache.git',`root_cache=${cache}`).replace('runtime=/var/lib/workspacex-cn/runtime',`runtime=${root}/runtime`).replace('repository=/opt/workspacex-cn/repository',`repository=${repo}`).replace('runner_cache=/opt/workspacex-cn/release-origin-cache.git',`runner_cache=${cache}`));
const run=(revision=candidate,base=baseline,extra={})=>spawnSync('bash',[script,'--export-bundle',revision,base,'gha-123-1'],{env:{...process.env,PATH:bin+':'+process.env.PATH,...extra},timeout:10000});fn({root,cache,candidate,baseline,run});}finally{rmSync(root,{recursive:true,force:true});}}
test('actual domestic bundle imports candidate and baseline with no HTTP remote',()=>fixture(({root,candidate,baseline,run})=>{const r=run();assert.equal(r.status,0,r.stderr.toString());const bundle=join(root,'source.bundle');writeFileSync(bundle,r.stdout);const checkout=join(root,'checkout');assert.equal(spawnSync('git',['clone',bundle,checkout]).status,0);for(const [ref,sha] of [['origin/main',candidate],['origin/main-cn',baseline]])assert.equal(spawnSync('git',['-C',checkout,'rev-parse',ref],{encoding:'utf8'}).stdout.trim(),sha);}));
test('wrong candidate rejects before bundle',()=>fixture(({baseline,run})=>{const r=run(baseline);assert.equal(r.status,3);assert.equal(r.stdout.length,0);}));
test('wrong baseline rejects before bundle',()=>fixture(({candidate,run})=>{const r=run(candidate,candidate);assert.equal(r.status,3);assert.equal(r.stdout.length,0);}));
test('absent cache rejects',()=>fixture(({cache,run})=>{rmSync(cache,{recursive:true});assert.equal(run().status,3);}));
test('borrowed and promisor caches fail before export',()=>fixture(({cache,run})=>{writeFileSync(join(cache,'objects/info/alternates'),join(cache,'objects')+'\n');assert.equal(run().status,3);rmSync(join(cache,'objects/info/alternates'));writeFileSync(join(cache,'objects/pack/hidden.promisor'),'');assert.equal(run().status,3);}));
test('held canonical lock prevents export',()=>fixture(({run})=>{const r=run(undefined,undefined,{TEST_LOCK_BUSY:'1'});assert.notEqual(r.status,0);assert.equal(r.stdout.length,0);}));
test('prepare workflow has no cross-border checkout or root-cache writer',()=>{const w=readFileSync('.github/workflows/prepare-cn-release.yml','utf8');assert.doesNotMatch(w,/actions\/checkout|git.*fetch|git -C.*cache.*update-ref/);assert.match(w,/workspacex-cn-export-source/);assert.match(w,/CN_RELEASE_WORKFLOW_SHA=\$\{GITHUB_SHA\}/);assert.match(w,/CN_RELEASE_SOURCE_SHA=\$\{revision\}/);assert.match(w,/CN_FROZEN_RELEASE_DISPATCHER_NOT_READY/);});

test('runner capability cannot invoke source cache writer',()=>{
 const wrapper=readFileSync('.harness/scripts/vm/export-cn-domestic-source.sh','utf8');
 assert.match(wrapper,/\$# -eq 3/);
 assert.match(wrapper,/--export-bundle "\$@"/);
 const b=readFileSync('.harness/scripts/vm/bootstrap-cn-production.sh','utf8');
 assert.match(b,/TRUSTED_EXPORT_BIN.*workspacex-cn-export-source/);
 assert.match(b,/"\$TRUSTED_PROMOTION_BIN" "\$TRUSTED_EXPORT_BIN" > "\$sudoers_temp"/);
 assert.doesNotMatch(b,/NOPASSWD:.*stage-source-cache/);
 const result=spawnSync('bash',['.harness/scripts/vm/export-cn-domestic-source.sh','--stage'],{encoding:'utf8'});
 assert.equal(result.status,2);assert.equal(result.stdout,'');
});

test('caller Git object-store override cannot change exported source',()=>fixture(({run})=>{
 const r=run(undefined,undefined,{GIT_DIR:'/does-not-exist',GIT_ALTERNATE_OBJECT_DIRECTORIES:'/untrusted-objects'});
 assert.equal(r.status,0,r.stderr.toString());assert.ok(r.stdout.subarray(0,24).toString().startsWith('# v2 git bundle'));
}));
