import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {parse} from 'yaml';
import {evaluateIf} from './lib/ci-job-conditions.mjs';
import {isHeavyE2eCommand} from './lib/heavy-suite-lock';
import {UI_PRODUCERS,requireRoute} from './ci-targeted-routing.mjs';
const load=name=>parse(readFileSync(`.github/workflows/${name}.yml`,'utf8'));
it('forces full plan artifacts for hourly/manual and keeps candidate coverage explicitly lightweight',()=>{
 const w=load('harness-acceptance'),scope=w.jobs['doc-smoke-scope'];
 expect(w.on.merge_group).toBeUndefined();expect(w.on.schedule).toEqual([{cron:'17 * * * *'}]);expect(scope.needs).toEqual(['freeze-source']);
 expect(scope.outputs.mode).toBe('${{ steps.regression.outputs.mode }}');expect(scope.outputs.plan_digest).toBe('${{ steps.regression.outputs.plan_digest }}');
 expect(scope.steps.find(s=>s.id==='regression').run).toContain('ci-targeted-ui.mjs --full "$RUNNER_TEMP/regression/plan.json"');
 expect(load('harness-verify').jobs['doc-smoke-scope']).toBeUndefined();
});
it('hourly full plan activates full real producers and omits UI-only subset producers',()=>{
 const w=load('harness-acceptance'),probe={eventName:'schedule',ref:'refs/heads/develop',baseBranch:'develop',regressionMode:'full'};
 for(const name of ['fullstack-smoke','base-package-tests','web-test-plan','chat-test-plan',...UI_PRODUCERS]){
  const job=w.jobs[name],names=[].concat(job.needs??[]),needsResults=new Map(names.map(n=>[n,'success']));expect(names).toContain('doc-smoke-scope');
  expect(evaluateIf(job.if,probe,{needsResults})).toBe(!UI_PRODUCERS.includes(name));
 }
 expect(load('harness-verify').jobs['targeted-ui-browser']).toBeUndefined();
});
it('stable aggregate outputs come from the mandatory proof-producing command',()=>{
 const jobs=load('harness-acceptance').jobs;
 for(const [name,kind]of [['full-regression-core','base'],['e2e-full','e2e']]){
  const job=jobs[name],route=job.steps.find(s=>s.id==='route');
  expect(route.run).toBe(`node .harness/scripts/ci-targeted-routing.mjs ${kind}`);
  expect(route.if).toBeUndefined();expect(route.env.CI_ROUTED_NEEDS).toBe('${{ toJSON(needs) }}');
  expect(job.outputs.verification_mode).toBe('${{ steps.route.outputs.mode }}');
  expect(job.outputs.plan_digest).toBe('${{ steps.route.outputs.plan_digest }}');
 }
});

it('keeps both real selected browser producers inside heavy E2E resource admission',()=>{
 for(const name of ['harness-acceptance']){
  const job=load(name).jobs['targeted-ui-browser'];
  const command=job.steps.find(s=>s.run?.includes('ci-targeted-runner.mjs chat-ui')).run;
  expect(command).toContain('with-test-isolation.ts -- node');
  const actual=/-- (node \.harness\/scripts\/ci-targeted-runner\.mjs chat-ui) /.exec(command);
  expect(actual).not.toBeNull();expect(isHeavyE2eCommand(actual[1].split(' '))).toBe(true);
 }
});

it.each([['full-regression-core','base'],['e2e-full','e2e']])('accepts actual %s workflow needs in both regression modes',(name,kind)=>{
 const job=load('harness-acceptance').jobs[name];
 for(const mode of ['full','targeted-ui']){
  const selected=kind==='base'?['base-compile','base-control-plane',...UI_PRODUCERS]:['full-regression-core',...UI_PRODUCERS];
  const actual=Object.fromEntries(job.needs.map((key:string)=>{
   if(key==='doc-smoke-scope')return [key,{result:'success',outputs:{mode,plan_digest:'a'.repeat(64)}}];
   const active=mode==='full'?!UI_PRODUCERS.includes(key):selected.includes(key);
   return [key,{result:active?'success':'skipped',outputs:active?{verdict:'success'}:{}}];
  }));
  expect(requireRoute(kind,actual).mode).toBe(mode);
 }
});
