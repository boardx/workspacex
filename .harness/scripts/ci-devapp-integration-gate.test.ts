import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
const jobs = parse(readFileSync('.github/workflows/backend-gates.yml', 'utf8')).jobs;
describe('Devapp deployment waits for integration validation before the privileged runner', () => {
  it('has a read-only hosted admission job and deployment depends on it', () => {
    const gate = jobs['integration-acceptance'];
    expect(gate).toBeDefined();
    expect(gate['runs-on']).toBe('ubuntu-latest');
    expect(gate.permissions).toEqual({contents:'read',actions:'read'});
    // setup-node detects pnpm from packageManager even without an explicit cache option.
    // This read-only helper uses only Node built-ins and must not require pnpm.
    const nodeSetup = gate.steps.find((step: {uses?: string}) => step.uses === 'actions/setup-node@v5');
    expect(nodeSetup.with['package-manager-cache']).toBe(false);
    expect(gate.steps.some((step: {uses?: string}) => step.uses?.startsWith('pnpm/action-setup'))).toBe(false);
    expect(gate.if).toContain("github.ref == 'refs/heads/develop'");
    expect(gate.if).toContain("github.event_name == 'push'");
    expect(jobs.deploy.needs).toContain('integration-acceptance');
    expect(jobs.deploy.if).toContain("needs.integration-acceptance.result == 'success'");
  });
});

import { INTEGRATION_CHECKS, integrationVerdict, inspectIntegration, waitForIntegration } from './ci-devapp-integration-gate.mjs';
const sha = 'a'.repeat(40);
const run = {id:20,workflow_id:7,head_sha:sha,head_branch:'develop',event:'push',path:'.github/workflows/harness-verify.yml',run_attempt:2,created_at:'2026-10-22T10:00:00Z',status:'completed',conclusion:'success'};
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
      if(path==='/actions/workflows/harness-verify.yml')return {id:7,path:run.path,state:'active'};
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
    const api=async(path:string)=>path.includes('/runs?')?{total_count:0,workflow_runs:[]}:{id:7,path:run.path,state:'active'};
    await expect(waitForIntegration({apiFactory:()=>api,sha,since:identity.since,clock:()=>now,sleep:async(ms:number)=>{now+=ms;},budgetMs:50})).rejects.toThrow('TIMEOUT');
  });
});
it('rejects a newer attempt started between run lookup and historical jobs lookup',async()=>{
  const api=async(path:string)=>{
    if(path==='/actions/workflows/harness-verify.yml')return {id:7,path:run.path,state:'active'};
    if(path.includes('/runs?'))return {total_count:1,workflow_runs:[run]};
    if(path.includes('/attempts/2/jobs'))return {total_count:greenJobs().length,jobs:greenJobs()};
    if(path==='/actions/runs/20')return {...run,run_attempt:3,status:'in_progress',conclusion:null};
    throw new Error('unexpected path');
  };
  await expect(inspectIntegration(api,identity)).rejects.toThrow('ATTEMPT_CHANGED');
});
