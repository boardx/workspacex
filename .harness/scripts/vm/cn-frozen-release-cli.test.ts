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
 const snapshot={schemaVersion:1,releaseSourceSha:source,attemptId:attempt,receiptSha256:hex,governanceReceiptSha256:hex,manifestSha256:hex,baselineSha256:hex,images:Object.fromEntries(['api','web','agent','sandbox'].map(k=>[k,'sha256:'+hex])),devapp:{status:'passed',sourceSha:source,runtimeSourceShas:Object.fromEntries(['api','web','agent','sandbox'].map(k=>[k,source])),browserAccepted:true,evidenceSha256:hex,workflowRunId:55}};
 const binding={releaseSourceSha:source,attemptId:attempt,receiptSha256:hex,governanceReceiptSha256:hex,manifestSha256:hex,baselineSha256:hex,images:snapshot.images,devappEvidenceSha256:hex,devappWorkflowRunId:55};
 git('tag','-a',tag,'-m',JSON.stringify(frozenTagBinding(binding)),source);const tagSha=git('rev-parse','refs/tags/'+tag);
 const checks=['verify-control-plane','verify-affected','verify-full-compile','merge-gate','backend-required'].map(name=>({name,head_sha:source,status:'completed',conclusion:'success',app:{slug:'github-actions'}}));
 const env=(review:boolean)=>({id:review?10:11,updated_at:'2026-10-01T00:00:00Z',protection_rules:review?[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{id:1}}]}]:[],deployment_branch_policy:{custom_branch_policies:true,protected_branches:false}});
 const pattern={ref_name:{include:['refs/tags/cn-prepared-*'],exclude:[]}};
 const maps:Record<string,unknown>={
  ["apps/github-actions"]:{id:1,slug:"github-actions"},
  [`repos/${repo}/rulesets?includes_parents=true&per_page=100&page=1`]:[{id:1,target:'tag',enforcement:'active',source_type:'Repository',source:repo},{id:2,target:'tag',enforcement:'active',source_type:'Repository',source:repo}],
  [`repos/${repo}/rulesets/1`]:{id:1,source_type:'Repository',source:repo,updated_at:'2026-10-01T00:00:00Z',target:'tag',enforcement:'active',conditions:pattern,bypass_actors:[],rules:[{type:'update'}]},
  [`repos/${repo}/rulesets/2`]:{id:2,source_type:'Repository',source:repo,updated_at:'2026-10-01T00:00:00Z',target:'tag',enforcement:'active',conditions:pattern,bypass_actors:[],rules:[{type:'update'},{type:'deletion'}]},
  [`repos/${repo}/environments/production-cn-promotion`]:env(true),
  [`repos/${repo}/environments/production-cn`]:env(false),
  [`repos/${repo}/environments/production-cn-promotion/deployment-branch-policies?per_page=100&page=1`]:{total_count:2,branch_policies:[{id:1,type:'branch',name:'main'},{id:2,type:'tag',name:'cn-prepared-*'}]},
  [`repos/${repo}/environments/production-cn/deployment-branch-policies?per_page=100&page=1`]:{total_count:3,branch_policies:[{id:1,type:'branch',name:'main'},{id:2,type:'branch',name:'main-cn'},{id:3,type:'tag',name:'cn-prepared-*'}]},
  [`repos/${repo}/git/ref/heads/main-cn`]:{object:{sha:baseline}},
  [`repos/${repo}/commits/${source}/check-runs?filter=latest&per_page=100&page=1`]:{total_count:checks.length,check_runs:checks},
  [`repos/${repo}/commits/${source}/statuses?per_page=100&page=1`]:[],
  [`repos/${repo}/actions/runs/55`]:{id:55,head_sha:source,path:'.github/workflows/real-model-chat-evidence.yml',status:'completed',conclusion:'success',repository:{full_name:repo},head_repository:{full_name:repo}},
  [`repos/${repo}/git/ref/tags/${tag}`]:{object:{type:'tag',sha:tagSha}},
  [`repos/${repo}/git/tags/${tagSha}`]:{tag,object:{type:'commit',sha:source},message:JSON.stringify(frozenTagBinding(binding))}
 };
 const bin=join(dir,'fakebin');mkdirSync(bin);writeFileSync(join(bin,'gh'),'#!/usr/bin/env python3\nimport os,sys,json\na=sys.argv[1:];assert a[0]=="api" and len(a)==2,"No API mutation authorized"\nv=json.load(open(os.environ["FIXTURE_MAP"]))\nassert a[1] in v,"Unexpected GitHub request"\nprint(json.dumps(v[a[1]]))\n');chmodSync(join(bin,'gh'),0o700);
 const mapfile=join(dir,'maps.json'),snapshotFile=join(dir,'snapshot.txt');
 const run=(patch:Record<string,string>={},mode="verify-dispatch")=>{writeFileSync(mapfile,JSON.stringify(maps));writeFileSync(snapshotFile,'CN_PROMOTION_IDENTITY_JSON='+JSON.stringify(snapshot)+'\n');return spawnSync(process.execPath,['--experimental-strip-types',helper,mode,snapshotFile],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,FIXTURE_MAP:mapfile,GITHUB_REPOSITORY:repo,GITHUB_SHA:source,GITHUB_REF:'refs/tags/'+tag,GITHUB_WORKFLOW_SHA:source,GITHUB_WORKFLOW_REF:`${repo}/.github/workflows/promote-cn-production.yml@refs/tags/${tag}`,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',REVISION:source,EXPECTED_MAIN_CN:baseline,ATTEMPT_ID:attempt,GITHUB_OUTPUT:'',...patch}})};
 return {run,maps,snapshot,source,baseline,main,tagSha,tag,dir};
}
describe('real Git frozen-source CLI with controlled GitHub observations',()=>{
 it('fails NOT_READY for a historical dispatcher instead of borrowing latest main',()=>{const f=fixture(false);expect(f.run().status).toBe(3)});
 it('accepts actual ancestor candidate/tag after main advances without build or mutation',()=>{const f=fixture();expect(f.source).not.toBe(f.main);const r=f.run();expect(r.status,r.stderr).toBe(0);expect(r.stdout).toContain('CN_FROZEN_RELEASE_IDENTITY_JSON=')});
 it('accepts root-verified governance adapter when workflow token cannot see bypass fields',()=>{
  const f=fixture(),p='repos/boardx/workspacex';
  (f.snapshot as any).governance={schemaVersion:1,kind:'governance',repository:'boardx/workspacex',sourceSha:f.source,attemptId:'gha-fixture-1',observedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+300000).toISOString(),governance:{promotion:structuredClone(f.maps[p+'/environments/production-cn-promotion']),promotionPolicies:structuredClone((f.maps[p+'/environments/production-cn-promotion/deployment-branch-policies?per_page=100&page=1'] as any).branch_policies),activation:structuredClone(f.maps[p+'/environments/production-cn']),activationPolicies:structuredClone((f.maps[p+'/environments/production-cn/deployment-branch-policies?per_page=100&page=1'] as any).branch_policies),tagRules:structuredClone([f.maps[p+'/rulesets/1'],f.maps[p+'/rulesets/2']])}};
  delete (f.maps[p+'/rulesets/1'] as any).bypass_actors;delete (f.maps[p+'/rulesets/2'] as any).bypass_actors;
  expect(f.run().status).toBe(0);
  const envkey=p+'/environments/production-cn-promotion',rulekey=p+'/rulesets/1';
  const oldenv=structuredClone(f.maps[envkey]),oldrule=structuredClone(f.maps[rulekey]);
  for(const patch of [{updated_at:'2026-10-01T00:00:01Z'},{updated_at:undefined},{id:99},{protection_rules:[]}]){f.maps[envkey]={...(oldenv as object),...patch};expect(f.run().status).toBe(3);}f.maps[envkey]=oldenv;
  for(const patch of [{updated_at:'2026-10-01T00:00:01Z'},{bypass_actors:[{actor_id:1}]},{rules:[]}]){f.maps[rulekey]={...(oldrule as object),...patch};expect(f.run().status).toBe(3);}f.maps[rulekey]=oldrule;
  const policykey=p+'/environments/production-cn-promotion/deployment-branch-policies?per_page=100&page=1',oldpolicy=structuredClone(f.maps[policykey]);(f.maps[policykey] as any).branch_policies[0].name='other';expect(f.run().status).toBe(3);f.maps[policykey]=oldpolicy;
  const summary=p+'/rulesets?includes_parents=true&per_page=100&page=1',oldsummary=f.maps[summary];f.maps[summary]=[];expect(f.run().status).toBe(3);f.maps[summary]=oldsummary;
  const result=f.run(),request=JSON.parse(result.stdout.split('CN_FROZEN_RELEASE_IDENTITY_JSON=')[1]).requestSha256;
  (f.snapshot as any).governanceReceiptSha256='d'.repeat(64);expect(f.run({EXPECTED_REQUEST_SHA256:request}).status).toBe(3);(f.snapshot as any).governanceReceiptSha256='c'.repeat(64);
  (f.snapshot as any).governance.attemptId='other';expect(f.run().status).toBe(3);
 });
 it('rejects changed attestation and incomplete actual checks before approval',()=>{const f=fixture(),key=`repos/boardx/workspacex/git/tags/${f.tagSha}`;const old=f.maps[key];f.maps[key]={tag:f.tag,object:{type:'commit',sha:f.source},message:'present-only'};expect(f.run().status).toBe(3);expect(f.run({GITHUB_REF:'refs/heads/main'},'freeze-tag').status).toBe(3);f.maps[key]=old;f.maps[`repos/boardx/workspacex/commits/${f.source}/check-runs?filter=latest&per_page=100&page=1`]={total_count:101,check_runs:[]};expect(f.run().status).toBe(3)});
 it('rejects moving main dispatch, missing evidence and prior-run request digest',()=>{const f=fixture();for(const patch of [{GITHUB_REF:'refs/heads/main'},{GITHUB_SHA:f.main},{EXPECTED_REQUEST_SHA256:'0'.repeat(64)}])expect(f.run(patch).status).toBe(3);f.snapshot.devapp.browserAccepted=false;expect(f.run().status).toBe(3)});
 it('verifies real human-creator native admission via current-attempt job API',()=>{
  const f=fixture(),prefix='repos/boardx/workspacex',actor={id:2325074,login:'usamshen'},url='https://github.com/boardx/workspacex/actions/runs/123/job/4';
  f.maps[`${prefix}/actions/runs/123/attempts/1`]={id:123,run_attempt:1,head_sha:f.source,path:'.github/workflows/promote-cn-production.yml',event:'workflow_dispatch',repository:{full_name:'boardx/workspacex'},head_repository:{full_name:'boardx/workspacex'},actor,triggering_actor:actor};
  const key=`${prefix}/actions/runs/123/attempts/1/jobs?per_page=100&page=1`;
  const job={id:4,run_id:123,run_attempt:1,head_sha:f.source,name:'admit',status:'completed',conclusion:'success',html_url:url};
  f.maps[key]={total_count:1,jobs:[job]};
  f.maps[`${prefix}/deployments?sha=${f.source}&environment=production-cn-promotion&per_page=100&page=1`]=[{id:1,sha:f.source,ref:f.tag,environment:'production-cn-promotion',creator:actor,performed_via_github_app:{id:1,slug:'github-actions'}}];
  f.maps[`${prefix}/deployments/1/statuses?per_page=100&page=1`]=[{created_at:'2026-10-01T00:00:00Z',state:'success',creator:actor,performed_via_github_app:null,log_url:url}];
  const r=f.run({},'verify-admission');expect(r.status,r.stderr).toBe(0);
  const rulekey=`${prefix}/rulesets/2`,prior=f.maps[rulekey];f.maps[rulekey]={...(prior as object),bypass_actors:undefined};expect(f.run().status).toBe(3);f.maps[rulekey]=prior;
  f.maps[key]={total_count:1,jobs:[{...job,conclusion:'failure'}]};expect(f.run({},'verify-admission').status).toBe(3);
 });

});

describe('actual embedded nonproduction tag proof program',()=>{
 const workflow=readFileSync(join(process.cwd(),'.github/workflows/cn-release-tag-proof.yml'),'utf8');
 const code=workflow.split("python3 - <<'PY'\n")[1].split('\n          PY')[0].split('\n').map(line=>line.slice(10)).join('\n');
 const fakeGh=`#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
a=sys.argv[1:];method=a[a.index('--method')+1];path=a[a.index('--method')+2];fields={}
for i in range(len(a)-1):
 if a[i] in ['-f','-F']:
  k,v=a[i+1].split('=',1);fields[k]=v
file=Path(os.environ['FIXTURE_STATE']);state=json.loads(file.read_text()) if file.exists() else {'refs':{}}
source='a'*40;other='b'*40;obj='c'*40;mode=os.environ['FIXTURE_MODE'];status=200;body={}
name=path.split('/tags/')[-1];protected=name.startswith('cn-release-proof-')
if '/rulesets?' in path:body=[{'id':1,'target':'tag','enforcement':'active'}]
elif path.endswith('/rulesets/1'):
 body={'id':1,'target':'tag','enforcement':'active','bypass_actors':[],'conditions':{'ref_name':{'include':['refs/tags/cn-release-proof-*'],'exclude':[]}},'rules':[{'type':'update'},{'type':'deletion'}]}
 if mode=='missing-bypass':body.pop('bypass_actors')
elif '/git/commits/' in path:body={'parents':[{'sha':other}]}
elif method=='POST' and path.endswith('/git/tags'):
 state['tag']={'tag':fields['tag'],'object':{'type':'commit','sha':source,'url':'fixture'},'message':fields['message'],'sha':obj};body=state['tag'];status=201
elif method=='POST' and path.endswith('/git/refs'):
 name=fields['ref'].split('refs/tags/')[1];state['refs'][name]=fields['sha'];body={'object':{'type':'tag' if name.startswith('cn-release-proof-') else 'commit','sha':fields['sha']}};status=201
elif method=='GET' and '/git/ref/tags/' in path:
 if name in state['refs']:body={'object':{'type':'tag' if protected else 'commit','sha':state['refs'][name]}}
 else:status=404;body={'message':'Not Found'}
elif method=='GET' and '/git/tags/' in path:body=state['tag']
elif method in ['PATCH','DELETE'] and '/git/refs/tags/' in path:
 if protected:
  if mode=='permission':status=403;body={'message':'Resource not accessible by integration'}
  elif mode==method.lower()+'-success':
   if method=='PATCH':state['refs'][name]=other
   else:state['refs'].pop(name,None);status=204;body=None
  else:
   if mode=='mutated-ref':state['refs'][name]=other
   status=422;body={'message':'Repository rule violations found: GH013; cannot '+('update' if method=='PATCH' else 'delete')+' protected ref'}
 elif method=='PATCH':state['refs'][name]=fields['sha'];body={'object':{'sha':fields['sha']}}
 elif mode=='cleanup-failure':status=500;body={'message':'fixture control cleanup failure'}
 else:state['refs'].pop(name,None);status=204;body=None
else:raise RuntimeError('Unexpected API '+method+' '+path)
file.write_text(json.dumps(state))
print('HTTP/2 '+str(status)+'\\ncontent-type: application/json\\n\\n'+(json.dumps(body) if body is not None else ''))
sys.exit(0 if 200<=status<300 else 1)
`;
 for(const mode of ['success','permission','patch-success','delete-success','mutated-ref','cleanup-failure','missing-bypass'])it('executes real proof code with '+mode,()=>{
  const dir=mkdtempSync(join(tmpdir(),'cn-tag-proof-'));owned.push(dir);mkdirSync(join(dir,'proof-evidence'));mkdirSync(join(dir,'bin'));
  writeFileSync(join(dir,'proof.py'),code);writeFileSync(join(dir,'bin/gh'),fakeGh);chmodSync(join(dir,'bin/gh'),0o700);
  const r=spawnSync('python3',['proof.py'],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,GH_REPO:'boardx/workspacex',SOURCE_SHA:'a'.repeat(40),RUN_ID:'123',RUN_ATTEMPT:'1',FIXTURE_MODE:mode,FIXTURE_STATE:join(dir,'state.json')}});
  if(mode==='success') {expect(r.status,r.stderr).toBe(0);expect(JSON.parse(readFileSync(join(dir,'proof-evidence/receipt.json'),'utf8')).status).toBe('passed')}
  else {expect(r.status).not.toBe(0);expect(()=>readFileSync(join(dir,'proof-evidence/receipt.json'))).toThrow();expect(r.stdout).not.toContain('CN_RELEASE_TAG_PROOF_PASS')}
 });
});
