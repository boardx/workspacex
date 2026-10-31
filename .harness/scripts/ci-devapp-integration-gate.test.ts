import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
const jobs = parse(readFileSync('.github/workflows/backend-gates.yml', 'utf8')).jobs;
describe('Image release owns read-only admission after cutover', () => {
  it('removes duplicate legacy admission and keeps the trusted image deployment entry', () => {
    expect(jobs['integration-acceptance']).toBeUndefined();
    expect(jobs.deploy).toBeUndefined();
    const release=parse(readFileSync('.github/workflows/image-release.yml','utf8'));
    const gate=release.jobs.admission;
    expect(gate['runs-on']).toBe('ubuntu-24.04');
    expect(gate.permissions).toEqual({contents:'read',actions:'read'});
    expect(gate.steps.find((s:{uses?:string})=>s.uses==='actions/setup-node@v5').with['package-manager-cache']).toBe(false);
    expect(gate.steps.some((s:{run?:string})=>s.run==='node .harness/scripts/ci-devapp-integration-gate.mjs')).toBe(true);
    expect(release.jobs.deploy.needs).toEqual(['plan','build','manifest','admission']);
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
