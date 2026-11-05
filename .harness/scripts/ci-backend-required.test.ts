import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {parse} from 'yaml';
import {backendFailures} from './ci-backend-required.mjs';
import {CURRENT_POLICY} from './lib/ci-check-policy.mjs';
const sha='a'.repeat(40),base='b'.repeat(40);
function results(mode='full') {
 const needs=Object.fromEntries(CURRENT_POLICY.aggregates['backend-required'].map((name:string)=>[name,{result:'success'}])) as any;
 needs['api-test-plan']={result:'success',outputs:{mode,plan_digest:'c'.repeat(64),source_sha:sha,base_sha:base}};
 if(mode==='targeted-ui')needs['gates-test']={result:'skipped'};
 return needs;
}
it('requires the full matrix for full routes and allows only its deliberate skip for proven UI routes',()=>{
 expect(backendFailures(results(),sha,base)).toEqual([]);
 expect(backendFailures(results('targeted-ui'),sha,base)).toEqual([]);
 for(const state of ['failure','cancelled','skipped',undefined]){
  const full=results();full['gates-test']={result:state};expect(backendFailures(full,sha,base)).toContain('gates-test');
 }
});
it('rejects missing, failed or mismatched scope proof and unrecognized routes',()=>{
 for(const mode of ['candidate-ui','',undefined]){
  const needs=results();needs['api-test-plan'].outputs.mode=mode;expect(backendFailures(needs,sha,base).length).toBeGreaterThan(0);
 }
 for(const patch of [{source_sha:base},{base_sha:sha},{plan_digest:''}]){
  const needs=results('targeted-ui');Object.assign(needs['api-test-plan'].outputs,patch);expect(backendFailures(needs,sha,base)).toContain('api-test-plan');
 }
 for(const state of ['failure','cancelled','skipped',undefined]){
  const needs=results('targeted-ui');needs['api-test-plan'].result=state;expect(backendFailures(needs,sha,base)).toContain('api-test-plan');
 }
 expect(backendFailures(null,sha,base).length).toBeGreaterThan(0);
 expect(backendFailures(results('targeted-ui'),undefined,base).length).toBeGreaterThan(0);
});
it('never waives any other backend lane or treats API failures as deliberate skips',()=>{
 for(const name of CURRENT_POLICY.aggregates['backend-required'].filter((n:string)=>!['api-test-plan','gates-test'].includes(n))){
  for(const result of ['skipped','cancelled','failure',undefined]){
   const needs=results('targeted-ui');needs[name]={result};expect(backendFailures(needs,sha,base)).toContain(name);
  }
 }
 for(const result of ['success','cancelled','failure',undefined]){
  const needs=results('targeted-ui');needs['gates-test']={result};expect(backendFailures(needs,sha,base)).toContain('gates-test');
 }
});
it('binds scope discovery and backend aggregation to the same event source and base',()=>{
 const w=parse(readFileSync('.github/workflows/backend-gates.yml','utf8'));
 expect(w.env.CI_SCOPE_BASE_SHA).toContain('github.event.merge_group.base_sha');
 const planner=w.jobs['api-test-plan'];
 expect(planner.outputs.mode).toBe('${{ steps.regression.outputs.mode }}');
 expect(planner.outputs.plan_digest).toBe('${{ steps.regression.outputs.plan_digest }}');
 expect(planner.steps.find((s:any)=>s.id==='regression').run).toBe("node .harness/scripts/ci-targeted-ui.mjs ${{ github.event_name != 'pull_request' && '--full' || '' }}");
 expect(planner.steps.find((s:any)=>s.id==='preflight').if).toBe("github.event_name == 'pull_request'");
 expect(planner.steps.find((s:any)=>s.run?.includes('pnpm install')).if).toBe("steps.preflight.outputs.candidate == 'true'");
 expect(w.jobs['gates-test'].if).toContain("needs.api-test-plan.outputs.mode == 'full'");
 expect(w.jobs['backend-required'].needs).toContain('api-test-plan');
 const gate=w.jobs['backend-required'].steps.find((s:any)=>s.run?.includes('ci-backend-required.mjs'));
 expect(gate.env.CI_SOURCE_SHA).toBe('${{ github.sha }}');
 expect(gate.env.CI_BACKEND_RESULTS).toBe('${{ toJSON(needs) }}');
});
