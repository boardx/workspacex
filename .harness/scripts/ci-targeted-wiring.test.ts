import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {parse} from 'yaml';
import {evaluateIf} from './lib/ci-job-conditions.mjs';
import {isHeavyE2eCommand} from './lib/heavy-suite-lock';
import {UI_PRODUCERS} from './ci-targeted-routing.mjs';
const load=name=>parse(readFileSync(`.github/workflows/${name}.yml`,'utf8'));
it('produces explicit plans on PR and queue, with runtime preparation only for a candidate',()=>{
 for(const name of ['harness-verify','harness-acceptance']){
  const w=load(name),job=w.jobs['doc-smoke-scope'];
  expect(w.env.CI_SCOPE_BASE_SHA).toContain('github.event.merge_group.base_sha');
  expect(job.outputs.mode).toBe('${{ steps.regression.outputs.mode }}');
  expect(job.outputs.plan_digest).toBe('${{ steps.regression.outputs.plan_digest }}');
  expect(job.steps.find(s=>s.run?.includes('pnpm install')).if).toBe("steps.preflight.outputs.candidate == 'true'");
  expect(job.steps.find(s=>s.id==='regression').run).toContain('ci-targeted-ui.mjs');
 }
});
it('selects the original fallback or real UI producers, never both; queue browser is not duplicated in PR workflow',()=>{
 const w=load('harness-acceptance');
 for(const mode of ['full','targeted-ui']){
  const probe={eventName:'merge_group',ref:'refs/heads/gh-readonly-queue/develop/pr-1-abc',baseBranch:'develop',regressionMode:mode};
  for(const name of ['fullstack-smoke','base-package-tests','web-test-plan','chat-test-plan',...UI_PRODUCERS]){
   const job=w.jobs[name],names=[].concat(job.needs??[]),needsResults=new Map(names.map(n=>[n,'success']));
   expect(names).toContain('doc-smoke-scope');
   expect(evaluateIf(job.if,probe,{needsResults})).toBe(UI_PRODUCERS.includes(name)?mode==='targeted-ui':mode==='full');
  }
  const browser=load('harness-verify').jobs['targeted-ui-browser'];
  expect(evaluateIf(browser.if,probe,{needsResults:new Map([['doc-smoke-scope','success']])})).toBe(false);
 }
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
 for(const name of ['harness-verify','harness-acceptance']){
  const job=load(name).jobs['targeted-ui-browser'];
  const command=job.steps.find(s=>s.run?.includes('ci-targeted-runner.mjs chat-ui')).run;
  expect(command).toContain('with-test-isolation.ts -- node');
  const actual=/-- (node \.harness\/scripts\/ci-targeted-runner\.mjs chat-ui) /.exec(command);
  expect(actual).not.toBeNull();expect(isHeavyE2eCommand(actual[1].split(' '))).toBe(true);
 }
});
