import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {CURRENT_POLICY,parsePolicy} from './lib/ci-check-policy.mjs';
import {classifyChecks} from './lib/pr-queue';
const old=JSON.parse(readFileSync(new URL('./fixtures/ci-check-policy-v4.json',import.meta.url),'utf8'));
it('records a new lightweight merge policy without rewriting historical full prerequisites',()=>{
 expect(CURRENT_POLICY.version).toBe(5);expect(CURRENT_POLICY.mergeVerificationMode).toBe('lightweight');
 expect(CURRENT_POLICY.fullRegression).toMatchObject({workflowPath:'.github/workflows/harness-acceptance.yml',events:['schedule','workflow_dispatch']});
 expect(CURRENT_POLICY.aggregates['queue-ready']).toEqual(CURRENT_POLICY.requiredChecks.filter(n=>n!=='queue-ready'));
 expect(parsePolicy(old)).toEqual(old);expect(old.aggregates['backend-required']).toContain('gates-test');expect(old.aggregates['backend-required']).toContain('e2e-core-loop');
 for(const mode of [undefined,'full','unknown'])expect(()=>parsePolicy({...CURRENT_POLICY,mergeVerificationMode:mode})).toThrow();
 for(const key of CURRENT_POLICY.requiredChecks){const facts=CURRENT_POLICY.requiredChecks.map(name=>({name,status:'COMPLETED',conclusion:name===key?'SKIPPED':'SUCCESS'}));expect(classifyChecks(facts).blocked.length).toBeGreaterThan(0);}
});

import {parse} from 'yaml';
import {evaluateIf} from './lib/ci-job-conditions.mjs';
it('bounds hourly fanout, serializes extended fixtures, and executes default API partitions only at the actual base producer',()=>{
 const full=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8'));
 expect(full.jobs['base-api-shards'].strategy['max-parallel']).toBe(4);expect(full.jobs['web-test-shards'].strategy['max-parallel']).toBe(2);expect(full.jobs['chat-test-shards'].strategy['max-parallel']).toBe(1);
 const backend=full.jobs['backend-full'];expect(backend.needs).toContain('full-regression-core');expect(backend.with).toEqual({api_source:'acceptance-base',api_source_sha:'${{ needs.freeze-source.outputs.sha }}'});
 const w=parse(readFileSync('.github/workflows/backend-gates.yml','utf8'));expect(w.jobs['gates-test'].if).toBe("inputs.api_source != 'acceptance-base'");expect(w.on.workflow_dispatch.inputs.api_source).toBeUndefined();
 let previous=['e2e-full','backend-full'];
 for(const [name,job]of Object.entries(full.jobs) as [string,any][]){
  if(!['board-full','skill-full','billing-full','devportal-browser'].includes(name)&&!name.startsWith('hourly-')||name==='hourly-full-result')continue;
  expect(job.needs).toEqual(['freeze-source',...previous]);previous=[name];
 }
});
it('declares every moved producer in the strict final full result and keeps cron calls test-only on immutable source',()=>{
 const full=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8'));
 const final=full.jobs['hourly-full-result'];expect(JSON.stringify(final)).toContain('ci-hourly-result.mjs');
 const probe={eventName:'schedule',ref:'refs/heads/develop',baseBranch:'develop'};
 const scheduled = (condition: string, runFull: 'true' | 'false') => evaluateIf(condition, probe, {
  needsOutputs: new Map([['needs.freeze-source.outputs.run_full', runFull]]),
 });
 expect(scheduled(final.if, 'true'), 'hourly-full-result admitted').toBe(true);
 expect(scheduled(final.if, 'false'), 'hourly-full-result no-op').toBe(false);
 for(const [name,job]of Object.entries(full.jobs) as [string,any][]){
  if(!job.uses)continue;
  expect(final.needs).toContain(name);
  expect(scheduled(job.if, 'true'), `${name} admitted`).toBe(true);
  expect(scheduled(job.if, 'false'), `${name} no-op`).toBe(false);
  const called=parse(readFileSync(job.uses.slice(2),'utf8'));expect(called.on.workflow_call).toBeDefined();
  for(const [id,producer]of Object.entries(called.jobs) as [string,any][]){
   expect(producer.environment,`${name}/${id}`).toBeUndefined();expect(JSON.stringify(producer['runs-on'])).not.toContain('self-hosted');
   for(const step of producer.steps??[])if(step.uses?.startsWith('actions/checkout@'))expect([undefined,'${{ github.sha }}']).toContain(step.with?.ref);
  }
 }
 for(const name of ['backend-full','board-full','skill-full','billing-full','devportal-browser','organization-create'])expect(final.needs).toContain(name);
});

it('cannot silently reduce or rename the six stable v5 required checks',()=>{
 for(const name of CURRENT_POLICY.requiredChecks){const requiredChecks=CURRENT_POLICY.requiredChecks.filter(x=>x!==name);const changed={...CURRENT_POLICY,requiredChecks,aggregates:{'queue-ready':requiredChecks.filter(x=>x!=='queue-ready')}};expect(()=>parsePolicy(changed)).toThrow();}
});
