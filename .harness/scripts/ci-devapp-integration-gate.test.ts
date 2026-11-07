import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
const jobs = parse(readFileSync('.github/workflows/backend-gates.yml', 'utf8')).jobs;
describe('Image release owns read-only admission after cutover', () => {
  it('removes duplicate legacy admission and keeps the trusted image deployment entry', () => {
    expect(jobs['integration-acceptance']).toBeUndefined();
    expect(jobs.deploy).toBeUndefined();
    const release=parse(readFileSync('.github/workflows/image-release.yml','utf8'));
    expect(release.jobs.admission).toBeUndefined();
    expect(release.jobs.deploy.needs).toEqual(['plan','build','manifest']);
    expect(release.jobs.deploy.steps.at(-1).run).toContain('/usr/local/bin/workspacex-image-release');
  });
});

import { INTEGRATION_CHECKS, integrationVerdict, inspectIntegration, waitForIntegration } from './ci-devapp-integration-gate.mjs';
const sha = 'a'.repeat(40);
const run = {id:20,workflow_id:7,head_sha:sha,head_branch:'develop',event:'push',path:'.github/workflows/harness-acceptance.yml',run_attempt:2,created_at:'2026-10-22T10:00:00Z',status:'completed',conclusion:'success'};
const identity = {sha,workflowId:7,since:Date.parse(run.created_at)-60000};
const greenJobs = () => INTEGRATION_CHECKS.map(name=>({name,run_id:20,run_attempt:2,head_sha:sha,status:'completed',conclusion:'success'}));
describe('exact-source admission rejects old, failed and uncertain integration results',()=>{
  it('requires every current-attempt check and the completed workflow',()=>{
    expect(integrationVerdict(run,greenJobs(),identity).state).toBe('success');
    expect(integrationVerdict({...run,status:'in_progress'},greenJobs(),identity).state).toBe('pending');
    expect(integrationVerdict({...run,conclusion:'failure'},greenJobs(),identity).state).toBe('failure');
    for(const conclusion of ['failure','skipped','cancelled','neutral',null]) for(const name of INTEGRATION_CHECKS){
      const jobs=greenJobs().map(job=>job.name===name?{...job,conclusion}:job);
      expect(integrationVerdict(run,jobs,identity).state).toBe('failure');
      expect(integrationVerdict({...run,status:'in_progress'},jobs,identity).state).toBe('failure');
    }
    expect(integrationVerdict(run,greenJobs().slice(1),identity).state).toBe('failure');
  });
  it('rejects mismatched source, branch, event, workflow, attempt, stale run and ambiguous checks',()=>{
    for(const delta of [{head_sha:'b'.repeat(40)},{head_branch:'main'},{event:'pull_request'},{workflow_id:8},{path:'other.yml'},{run_attempt:0},{created_at:'2026-10-20T00:00:00Z'}]) expect(()=>integrationVerdict({...run,...delta},greenJobs(),identity)).toThrow('IDENTITY');
    for(const delta of [{run_id:19},{run_attempt:1},{head_sha:'b'.repeat(40)}]) expect(()=>integrationVerdict(run,[{...greenJobs()[0],...delta},...greenJobs().slice(1)],identity)).toThrow('JOB_IDENTITY');
    expect(()=>integrationVerdict(run,[...greenJobs(),greenJobs()[0]],identity)).toThrow('AMBIGUOUS');
  });
  it('uses the latest matching run and attempt-specific jobs, not an older green run',async()=>{
    const paths:string[]=[];
    const api=async(path:string)=>{
      paths.push(path);
      if(path==='/actions/workflows/harness-acceptance.yml')return {id:7,path:`.github/workflows/${path.split('/').at(-1)}`,state:'active'};
      if(path.includes('/runs?'))return {total_count:2,workflow_runs:[{...run,id:19,run_attempt:1},run]};
      if(path.includes('/attempts/2/jobs'))return {total_count:greenJobs().length,jobs:greenJobs().map(j=>({...j,conclusion:'failure'}))};
      throw new Error('unexpected path');
    };
    expect((await inspectIntegration(api,identity)).state).toBe('failure');
    expect(paths.at(-1)).toContain('/20/attempts/2/jobs');
  });
  it('stops on API errors and expires rather than authorizing a missing run',async()=>{
    await expect(waitForIntegration({apiFactory:()=>async()=>{throw new Error('unavailable');},sha,since:identity.since})).rejects.toThrow('unavailable');
    let now=0;
    const api=async(path:string)=>path.includes('/runs?')?{total_count:0,workflow_runs:[]}:{id:7,path:`.github/workflows/${path.split('/').at(-1)}`,state:'active'};
    await expect(waitForIntegration({apiFactory:()=>api,sha,since:identity.since,clock:()=>now,sleep:async(ms:number)=>{now+=ms;},budgetMs:50})).rejects.toThrow('TIMEOUT');
  });
});
it('rejects a newer attempt started between run lookup and historical jobs lookup',async()=>{
  const api=async(path:string)=>{
    if(path==='/actions/workflows/harness-acceptance.yml')return {id:7,path:`.github/workflows/${path.split('/').at(-1)}`,state:'active'};
    if(path.includes('/runs?'))return {total_count:1,workflow_runs:[run]};
    if(path.includes('/attempts/2/jobs'))return {total_count:greenJobs().length,jobs:greenJobs()};
    if(path==='/actions/runs/20')return {...run,run_attempt:3,status:'in_progress',conclusion:null};
    throw new Error('unexpected path');
  };
  await expect(inspectIntegration(api,identity)).rejects.toThrow('ATTEMPT_CHANGED');
});

import {SOURCE_VERIFICATION_PROFILES} from './ci-devapp-integration-gate.mjs';
it.each(['push','merge_group'] as const)('requires all producers on %s, never either one alone',async(mode)=>{
 const specs=SOURCE_VERIFICATION_PROFILES[mode];
 let now=0;
 const makeApi=(failed:string|undefined)=>async(path:string)=>{
  const index=path.includes('harness-verify.yml')||path.includes('/workflows/7/')||path.includes('/runs/30')?0:path.includes('backend-gates.yml')||path.includes('/workflows/9/')||path.includes('/runs/40')?2:1;
  const spec=specs[index]!;
  const id=index===0?30:index===1?20:40;
  const producer={...run,id,workflow_id:index+7,path:spec.workflowPath,event:mode,head_branch:mode==='push'?'develop':`gh-readonly-queue/develop/pr-1-${sha}`};
  if(path.startsWith('/actions/workflows/')&&!path.includes('/runs?')) return {id:index+7,path:spec.workflowPath,state:'active'};
  if(path.includes('/runs?'))return {total_count:1,workflow_runs:[producer]};
  if(path.endsWith('/jobs?per_page=100'))return {total_count:spec.checks.length,jobs:spec.checks.map(name=>({name,run_id:id,run_attempt:2,head_sha:sha,status:'completed',conclusion:name===failed?'failure':'success'}))};
  return producer;
 };
 await expect(waitForIntegration({apiFactory:()=>makeApi(undefined),sha,since:identity.since,clock:()=>now,sleep:async(ms:number)=>{now+=ms;},budgetMs:100,mode})).resolves.toMatchObject({state:'success'});
 for(const spec of specs)for(const name of spec.checks){
  await expect(waitForIntegration({apiFactory:()=>makeApi(name),sha,since:identity.since,clock:()=>now,sleep:async(ms:number)=>{now+=ms;},budgetMs:100,mode})).rejects.toThrow('REJECTED');
 }
});

it('can admit completed compile jobs while unrelated queue work is still running, without a cyclic workflow dependency',()=>{
 const spec=SOURCE_VERIFICATION_PROFILES.merge_group[0];
 const active={...run,event:'merge_group',head_branch:`gh-readonly-queue/develop/pr-1-${sha}`,path:spec.workflowPath,status:'in_progress',conclusion:null};
 const checks=['verify-full-compile'];
 const jobs=[{name:checks[0],run_id:20,run_attempt:2,head_sha:sha,status:'completed',conclusion:'success'}];
 const context={...identity,event:'merge_group',workflowPath:spec.workflowPath,checks,allowRunning:true};
 expect(integrationVerdict(active,jobs,context).state).toBe('success');
 expect(integrationVerdict(active,jobs,{...context,allowRunning:false}).state).toBe('pending');
 expect(integrationVerdict(active,[{...jobs[0],conclusion:'failure'}],context).state).toBe('failure');
 expect(()=>integrationVerdict({...active,event:'push'},jobs,context)).toThrow('IDENTITY');
});

it('reuses only the exact candidate control-plane result while compile is still running',async()=>{
 const qrun={...run,path:'.github/workflows/harness-verify.yml',event:'merge_group',head_branch:'gh-readonly-queue/develop/pr-6064-'+ 'b'.repeat(40),status:'in_progress',conclusion:null};
 const api=async(path:string)=>{
  if(path==='/actions/workflows/harness-verify.yml')return{id:7,path:qrun.path,state:'active'};
  if(path.includes('/runs?'))return{total_count:1,workflow_runs:[qrun]};
  if(path.includes('/jobs?'))return{total_count:1,jobs:[{name:'verify-control-plane',run_id:qrun.id,run_attempt:qrun.run_attempt,head_sha:sha,status:'completed',conclusion:'success'}]};
  if(path===`/actions/runs/${qrun.id}`)return qrun;
  throw Error('unexpected producer');
 };
 expect((await waitForIntegration({apiFactory:()=>api,sha,since:0,mode:'merge_group',onlyControlPlane:true})).state).toBe('success');
});

function pollingFixture(readyAt=Infinity,failedAt=Infinity){
 let now=0,calls=0,metadata=0;
 const producer={...run,path:'.github/workflows/harness-verify.yml',head_branch:'gh-readonly-queue/develop/pr-1-abcdef0',event:'merge_group',status:'in_progress',conclusion:null,run_attempt:1};
 const api=async(path:string)=>{
  calls++;
  if(path==='/actions/workflows/harness-verify.yml'){metadata++;return{id:7,path:producer.path,state:'active'};}
  if(path.includes('/runs?'))return{total_count:1,workflow_runs:[producer]};
  if(path.includes('/jobs?'))return{total_count:1,jobs:[{name:'verify-full-compile',run_id:20,run_attempt:1,head_sha:sha,status:now>=Math.min(readyAt,failedAt)?'completed':'in_progress',conclusion:now>=failedAt?'failure':now>=readyAt?'success':null}]};
  return producer;
 };
 return {api,clock:()=>now,sleep:async(ms:number)=>{now+=ms;},calls:()=>calls,metadata:()=>metadata};
}
it('bounds ten55minute pending waiters under450charged calls without multiplying metadata polls',async()=>{
 let total=0;
 for(let i=0;i<10;i++){
  const f=pollingFixture();await expect(waitForIntegration({apiFactory:()=>f.api,sha,since:0,mode:'merge_group',onlyCompile:true,clock:f.clock,sleep:f.sleep})).rejects.toThrow('TIMEOUT');
  expect(f.calls()).toBeLessThanOrEqual(45);expect(f.metadata()).toBe(1);total+=f.calls();
 }
 expect(total).toBeLessThanOrEqual(450);
});
it('observes producer failure within the next bounded poll and verifies terminal source identity',async()=>{
 const f=pollingFixture(Infinity,200000);await expect(waitForIntegration({apiFactory:()=>f.api,sha,since:0,mode:'merge_group',onlyCompile:true,clock:f.clock,sleep:f.sleep})).rejects.toThrow('REJECTED');
 expect(f.clock()).toBeLessThanOrEqual(440000);
 const green=pollingFixture(900000);await expect(waitForIntegration({apiFactory:()=>green.api,sha,since:0,mode:'merge_group',onlyCompile:true,clock:green.clock,sleep:green.sleep})).resolves.toMatchObject({state:'success'});expect(green.calls()).toBeLessThan(30);
});
it('honors explicit rate delay and deadline while never retrying generic authorization failures',async()=>{
 let now=0,calls=0;
 const rate=Object.assign(Error('lookup_rate_limited'),{rateLimited:true,retryAfterMs:70000,reason:'lookup_rate_limited'});
 await expect(waitForIntegration({apiFactory:()=>async()=>{calls++;throw rate;},sha,since:0,mode:'merge_group',onlyCompile:true,clock:()=>now,sleep:async(ms:number)=>{now+=ms;},budgetMs:50000})).rejects.toThrow('TIMEOUT');expect(calls).toBe(1);expect(now).toBe(50000);
 calls=0;now=0;await expect(waitForIntegration({apiFactory:()=>async()=>{calls++;throw Error('lookup_forbidden');},sha,since:0,mode:'merge_group',onlyCompile:true,clock:()=>now,sleep:async(ms:number)=>{now+=ms;}})).rejects.toThrow('lookup_forbidden');expect(calls).toBe(1);expect(now).toBe(0);
});
it('does not return a stale failed run when a newer same-SHA producer appeared during terminal discovery',async()=>{
 let now=0,lists=0;
 const producer={...run,path:'.github/workflows/harness-verify.yml',head_branch:'gh-readonly-queue/develop/pr-1-abcdef0',event:'merge_group',status:'in_progress',conclusion:null,run_attempt:1};
 const api=async(path:string)=>{
  if(path==='/actions/workflows/harness-verify.yml')return{id:7,path:producer.path,state:'active'};
  if(path.includes('/runs?'))return{total_count:1,workflow_runs:[{...producer,id:++lists===1?20:21}]};
  if(path.includes('/jobs?')){const id=path.includes('/20/')?20:21;return{total_count:1,jobs:[{name:'verify-full-compile',run_id:id,run_attempt:1,head_sha:sha,status:'completed',conclusion:id===20?'failure':'success'}]};}
  return{...producer,id:21};
 };
 await expect(waitForIntegration({apiFactory:()=>api,sha,since:0,mode:'merge_group',onlyCompile:true,clock:()=>now,sleep:async(ms:number)=>{now+=ms;}})).resolves.toMatchObject({state:'success'});expect(now).toBe(15000);
});
it('cached immutable selected checks never authorize a changed run attempt',async()=>{
 const state={};let changed=false;
 const current={...run,status:'in_progress',conclusion:null as string|null};
 const api=async(path:string)=>{
  if(path==='/actions/workflows/harness-acceptance.yml')return{id:7,path:run.path,state:'active'};
  if(path.includes('/runs?'))return{total_count:1,workflow_runs:[current]};
  if(path.includes('/jobs?'))return{total_count:greenJobs().length,jobs:greenJobs()};
  return{...current,run_attempt:changed?3:2};
 };
 expect((await inspectIntegration(api,identity,state)).state).toBe('pending');
 current.status='completed';current.conclusion='success';changed=true;
 await expect(inspectIntegration(api,identity,state)).rejects.toThrow('ATTEMPT_CHANGED');
});
it('resumes only after an explicit rate backoff and still requires exact successful proof',async()=>{
 const f=pollingFixture(0);let first=true;
 const apiFactory=()=>async(path:string)=>{if(first){first=false;throw Object.assign(Error('lookup_rate_limited'),{reason:'lookup_rate_limited',rateLimited:true,retryAfterMs:70000});}return f.api(path);};
 await expect(waitForIntegration({apiFactory,sha,since:0,mode:'merge_group',onlyCompile:true,clock:f.clock,sleep:f.sleep,budgetMs:150000})).resolves.toMatchObject({state:'success'});expect(f.clock()).toBe(70000);
});
it('starts no further GET once the overall deadline expires inside a lookup round',async()=>{
 let now=0,calls=0;const f=pollingFixture();
 const api=async(path:string)=>{calls++;now+=40;return f.api(path);};
 await expect(waitForIntegration({apiFactory:()=>api,sha,since:0,mode:'merge_group',onlyCompile:true,clock:()=>now,sleep:async(ms:number)=>{now+=ms;},budgetMs:50})).rejects.toThrow('TIMEOUT');expect(calls).toBe(2);
});
it.each([45,53,Infinity])('preserves terminal proof budget for three producers at minute%i',async readyMinute=>{
 const {waitForIntegrationSpecs}=await import('./ci-devapp-integration-gate.mjs');let now=0,calls=0;
 const specs=['one','two','three'].map((name,i)=>({workflowPath:`.github/workflows/${name}.yml`,checks:['check'],id:i+1}));
 const apiFactory=()=>async(path:string)=>{
  calls++;const metadata=specs.find(s=>path===`/actions/workflows/${s.workflowPath.split('/').at(-1)}`);
  if(metadata)return{id:metadata.id,path:metadata.workflowPath,state:'active'};
  const id=Number(path.split('/')[3]);const spec=specs.find(s=>path.includes('/workflows/')?s.id===id:s.id+20===id)!;
  const current={id:spec.id+20,workflow_id:spec.id,path:spec.workflowPath,head_sha:sha,head_branch:'develop',event:'push',run_attempt:1,created_at:run.created_at,status:now>=readyMinute*60000?'completed':'in_progress',conclusion:now>=readyMinute*60000?'success':null};
  if(path.includes('/runs?'))return{total_count:1,workflow_runs:[current]};
  if(path.includes('/jobs?'))return{total_count:1,jobs:[{name:'check',run_id:current.id,run_attempt:1,head_sha:sha,status:current.status,conclusion:current.conclusion}]};
  return current;
 };
 const outcome=waitForIntegrationSpecs({apiFactory,sha,since:0,event:'push',specs,clock:()=>now,sleep:async(ms:number)=>{now+=ms;}});
 if(Number.isFinite(readyMinute)){await expect(outcome).resolves.toMatchObject({state:'success'});expect(now).toBeGreaterThanOrEqual(readyMinute*60000);expect(now).toBeLessThan(55*60000);}else{await expect(outcome).rejects.toThrow('TIMEOUT');expect(now).toBe(55*60000);}
 expect(calls).toBeLessThanOrEqual(45);
});
