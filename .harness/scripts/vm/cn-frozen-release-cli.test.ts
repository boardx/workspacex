import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { frozenTagBinding, releaseTag } from "./cn-frozen-release-identity.mjs";
const owned:string[]=[];
afterEach(()=>{for(const p of owned.splice(0))rmSync(p,{recursive:true,force:true})});
const helper=join(process.cwd(),'.harness/scripts/vm/cn-frozen-release-identity.mjs');
function fixture(compatible = true) {
 const dir=mkdtempSync(join(tmpdir(),'cn-frozen-identity-'));owned.push(dir);
 const git=(...args:string[])=>{const r=spawnSync('git',args,{cwd:dir,encoding:'utf8'});expect(r.status,r.stderr).toBe(0);return r.stdout.trim()};
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 writeFileSync(join(dir,'baseline'),'baseline');git('add','baseline');git('commit','-qm','baseline');const baseline=git('rev-parse','HEAD');
 mkdirSync(join(dir,'.github/workflows'),{recursive:true});mkdirSync(join(dir,'.harness/scripts/vm'),{recursive:true});
 writeFileSync(join(dir,'.github/workflows/promote-cn-production.yml'),compatible?'# CN_FROZEN_RELEASE_DISPATCHER_V1\n':'# historical dispatcher\n');writeFileSync(join(dir,'.harness/scripts/vm/cn-frozen-release-identity.mjs'),readFileSync(helper));git('add','.');git('commit','-qm','frozen compatible candidate');const source=git('rev-parse','HEAD');
 writeFileSync(join(dir,'new-main'),'later');git('add','.');git('commit','-qm','main advances');const main=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/main',main);git('update-ref','refs/remotes/origin/main-cn',baseline);git('checkout','-q','--detach',source);
 const attempt='gha-fixture-1',tag=releaseTag(source,attempt),hex='c'.repeat(64),repo='boardx/workspacex';
 const snapshot={schemaVersion:1,releaseSourceSha:source,attemptId:attempt,receiptSha256:hex,manifestSha256:hex,baselineSha256:hex,images:Object.fromEntries(['api','web','agent','sandbox'].map(k=>[k,'sha256:'+hex])),devapp:{status:'passed',sourceSha:source,runtimeSourceShas:Object.fromEntries(['api','web','agent','sandbox'].map(k=>[k,source])),browserAccepted:true,evidenceSha256:hex,workflowRunId:55}};
 const binding={releaseSourceSha:source,attemptId:attempt,receiptSha256:hex,manifestSha256:hex,baselineSha256:hex,images:snapshot.images,devappEvidenceSha256:hex,devappWorkflowRunId:55};
 git('tag','-a',tag,'-m',JSON.stringify(frozenTagBinding(binding)),source);const tagSha=git('rev-parse','refs/tags/'+tag);
 const checks=['verify-control-plane','verify-affected','verify-full-compile','merge-gate','backend-required'].map(name=>({name,head_sha:source,status:'completed',conclusion:'success',app:{slug:'github-actions'}}));
 const env=(review:boolean)=>({protection_rules:review?[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{id:1}}]}]:[],deployment_branch_policy:{custom_branch_policies:true,protected_branches:false}});
 const pattern={ref_name:{include:['refs/tags/cn-prepared-*'],exclude:[]}};
 const maps:Record<string,unknown>={
  ["apps/github-actions"]:{id:1,slug:"github-actions"},
  [`repos/${repo}/rulesets?includes_parents=true&per_page=100&page=1`]:[{id:1,target:'tag',enforcement:'active'},{id:2,target:'tag',enforcement:'active'}],
  [`repos/${repo}/rulesets/1`]:{target:'tag',enforcement:'active',conditions:pattern,bypass_actors:[{actor_type:'Integration',actor_id:1,bypass_mode:'always'}],rules:[{type:'creation'}]},
  [`repos/${repo}/rulesets/2`]:{target:'tag',enforcement:'active',conditions:pattern,bypass_actors:[],rules:[{type:'update'},{type:'deletion'}]},
  [`repos/${repo}/environments/production-cn-promotion`]:env(true),
  [`repos/${repo}/environments/production-cn`]:env(false),
  [`repos/${repo}/environments/production-cn-promotion/deployment-branch-policies?per_page=100&page=1`]:{total_count:2,branch_policies:[{type:'branch',name:'main'},{type:'tag',name:'cn-prepared-*'}]},
  [`repos/${repo}/environments/production-cn/deployment-branch-policies?per_page=100&page=1`]:{total_count:3,branch_policies:[{type:'branch',name:'main'},{type:'branch',name:'main-cn'},{type:'tag',name:'cn-prepared-*'}]},
  [`repos/${repo}/git/ref/heads/main-cn`]:{object:{sha:baseline}},
  [`repos/${repo}/commits/${source}/check-runs?filter=latest&per_page=100&page=1`]:{total_count:checks.length,check_runs:checks},
  [`repos/${repo}/commits/${source}/statuses?per_page=100&page=1`]:[],
  [`repos/${repo}/actions/runs/55`]:{id:55,head_sha:source,path:'.github/workflows/real-model-chat-evidence.yml',status:'completed',conclusion:'success',repository:{full_name:repo},head_repository:{full_name:repo}},
  [`repos/${repo}/git/ref/tags/${tag}`]:{object:{type:'tag',sha:tagSha}},
  [`repos/${repo}/git/tags/${tagSha}`]:{tag,object:{type:'commit',sha:source},message:JSON.stringify(frozenTagBinding(binding))}
 };
 const bin=join(dir,'fakebin');mkdirSync(bin);writeFileSync(join(bin,'gh'),'#!/usr/bin/env python3\nimport os,sys,json\na=sys.argv[1:];assert a[0]=="api" and len(a)==2,"No API mutation authorized"\nv=json.load(open(os.environ["FIXTURE_MAP"]))\nassert a[1] in v,"Unexpected GitHub request"\nprint(json.dumps(v[a[1]]))\n');chmodSync(join(bin,'gh'),0o700);
 const mapfile=join(dir,'maps.json'),snapshotFile=join(dir,'snapshot.txt');
 const run=(patch:Record<string,string>={})=>{writeFileSync(mapfile,JSON.stringify(maps));writeFileSync(snapshotFile,'CN_PROMOTION_IDENTITY_JSON='+JSON.stringify(snapshot)+'\n');return spawnSync(process.execPath,['--experimental-strip-types',helper,'verify-dispatch',snapshotFile],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,FIXTURE_MAP:mapfile,GITHUB_REPOSITORY:repo,GITHUB_SHA:source,GITHUB_REF:'refs/tags/'+tag,GITHUB_WORKFLOW_SHA:source,GITHUB_WORKFLOW_REF:`${repo}/.github/workflows/promote-cn-production.yml@refs/tags/${tag}`,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',REVISION:source,EXPECTED_MAIN_CN:baseline,ATTEMPT_ID:attempt,CN_RELEASE_TAG_APP_ID:'1',GITHUB_OUTPUT:'',...patch}})};
 return {run,maps,snapshot,source,baseline,main,tagSha,tag,dir};
}
describe('real Git frozen-source CLI with controlled GitHub observations',()=>{
 it('fails NOT_READY for a historical dispatcher instead of borrowing latest main',()=>{const f=fixture(false);expect(f.run().status).toBe(3)});
 it('accepts actual ancestor candidate/tag after main advances without build or mutation',()=>{const f=fixture();expect(f.source).not.toBe(f.main);const r=f.run();expect(r.status,r.stderr).toBe(0);expect(r.stdout).toContain('CN_FROZEN_RELEASE_IDENTITY_JSON=')});
 it('rejects changed attestation and incomplete actual checks before approval',()=>{const f=fixture(),key=`repos/boardx/workspacex/git/tags/${f.tagSha}`;const old=f.maps[key];f.maps[key]={tag:f.tag,object:{type:'commit',sha:f.source},message:'present-only'};expect(f.run().status).toBe(3);f.maps[key]=old;f.maps[`repos/boardx/workspacex/commits/${f.source}/check-runs?filter=latest&per_page=100&page=1`]={total_count:101,check_runs:[]};expect(f.run().status).toBe(3)});
 it('rejects moving main dispatch, missing evidence and prior-run request digest',()=>{const f=fixture();for(const patch of [{GITHUB_REF:'refs/heads/main'},{GITHUB_SHA:f.main},{EXPECTED_REQUEST_SHA256:'0'.repeat(64)}])expect(f.run(patch).status).toBe(3);f.snapshot.devapp.browserAccepted=false;expect(f.run().status).toBe(3)});
});
