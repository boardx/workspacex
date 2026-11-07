import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {lightweightPlan,requireLightweightResults,requireFrozenDevelop} from './ci-lightweight.mjs';
const sourceSha='a'.repeat(40),baseSha='b'.repeat(40);
const workflow=(name:string)=>parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`,import.meta.url),'utf8'));
describe('explicit lightweight evidence, separate from full regression',()=>{
 it('binds a deterministic limited unit selection to exact source/base and reports uncovered runtime impact',()=>{
  const p=lightweightPlan(['apps/api/src/domain/chat/service.ts','packages/contracts/src/deployment.ts'],{sourceSha,baseSha,exists:()=>true});
  expect(p).toMatchObject({mode:'lightweight',sourceSha,baseSha,fullRegression:false});
  expect(p.unitFiles).toContain('packages/contracts/tests/deployment.test.ts');
  expect(p.deferredPaths).toContain('apps/api/src/domain/chat/service.ts');
  expect(lightweightPlan(['packages/contracts/src/deployment.ts','apps/api/src/domain/chat/service.ts'],{sourceSha,baseSha,exists:()=>true})).toEqual(p);
 });
 it('selects known CI helper companion tests and never promotes arbitrary runtime integration tests',()=>{
  const p=lightweightPlan(['.harness/scripts/ci-lightweight.mjs','apps/api/tests/chat.integration.test.ts'],{sourceSha,baseSha,exists:()=>true});
  expect(p.unitFiles).toContain('.harness/scripts/ci-lightweight.test.ts');
  expect(p.unitFiles.some((p:string)=>p.startsWith('apps/api'))).toBe(false);
 });
 it.each([null,[],['../escape'],['/absolute'],['a//b']])('rejects missing/empty/unsafe diff %j',paths=>{
  expect(()=>lightweightPlan(paths,{sourceSha,baseSha,exists:()=>true})).toThrow();
 });
 it('rejects invalid SHA and missing mandatory baseline tests rather than passing no tests',()=>{
  expect(()=>lightweightPlan(['README.md'],{sourceSha:'',baseSha,exists:()=>true})).toThrow();
  expect(()=>lightweightPlan(['README.md'],{sourceSha,baseSha,exists:()=>false})).toThrow();
 });
 const names=['verify-control-plane','verify-affected','verify-full-compile','merge-gate','backend-required'];
 const needs=()=>Object.fromEntries(names.map(name=>[name,{result:'success'}]));
 it('accepts only the exact complete successful producer set with lightweight identity',()=>{
  expect(requireLightweightResults(needs(),{sourceSha,baseSha})).toMatchObject({mode:'lightweight',sourceSha,baseSha,fullRegression:false});
  for(const name of names)for(const result of ['failure','cancelled','skipped',undefined])expect(()=>requireLightweightResults({...needs(),[name]:{result}},{sourceSha,baseSha})).toThrow();
  expect(()=>requireLightweightResults({...needs(),extra:{result:'success'}},{sourceSha,baseSha})).toThrow();
  expect(()=>requireLightweightResults({}, {sourceSha,baseSha})).toThrow();
 });
 it('allows only scheduled/manual immutable develop full runs, never a candidate or stale checkout',()=>{
  for(const event of ['schedule','workflow_dispatch'])expect(requireFrozenDevelop({event,ref:'refs/heads/develop',sha:sourceSha,head:sourceSha,repository:'boardx/workspacex'})).toBe(sourceSha);
  for(const override of [{event:'merge_group'},{ref:'refs/heads/main'},{head:baseSha},{repository:'else/repo'}])expect(()=>requireFrozenDevelop({event:'schedule',ref:'refs/heads/develop',sha:sourceSha,head:sourceSha,repository:'boardx/workspacex',...override})).toThrow();
 });
});
describe('routing topology',()=>{
 it('emits all six required checks in one real unprivileged PR/queue DAG without broad tests',()=>{
  const w=workflow('harness-verify');expect(w.on.pull_request.branches).toEqual(['develop']);expect(w.on.merge_group.branches).toEqual(['develop']);
  const required=['verify-control-plane','verify-affected','verify-full-compile','merge-gate','backend-required','queue-ready'];
  expect(Object.keys(w.jobs).sort()).toEqual(required.sort());
  expect(w.jobs['queue-ready'].needs.sort()).toEqual(required.filter(x=>x!=='queue-ready').sort());
  expect(w.jobs['queue-ready'].if).toBe('always()');
  const raw=JSON.stringify(w.jobs);expect(raw).not.toMatch(/playwright|docker compose|vitest run --dir|ci-queue-ready\.mjs --compile|run-affected-tests/);
  expect(JSON.stringify(w.jobs['verify-full-compile'])).toContain('pnpm turbo run build');
  expect(JSON.stringify(w.jobs['verify-full-compile'])).toContain('pnpm turbo run typecheck lint');
  for(const job of Object.values(w.jobs) as any[])expect(job['continue-on-error']).toBeUndefined();
 });
 it('runs complete hourly/manual suites at exact frozen develop, keeping bounded unfinished hourly work',()=>{
  const w=workflow('harness-acceptance');expect(w.name).toBe('harness-acceptance');expect(w.on.merge_group).toBeUndefined();expect(w.on.schedule).toEqual([{cron:'17 * * * *'}]);
  expect(w.concurrency['cancel-in-progress']).toBe(false);expect(w.concurrency.queue).toBe('single');
  expect(w.jobs['queue-ready']).toBeUndefined();expect(w.env.CI_FRESH_RUN).toBe('true');
  expect(JSON.stringify(w.jobs['freeze-source'])).toContain('ci-lightweight.mjs frozen-develop');
  for(const name of ['backend-full','board-full','skill-full','billing-full'])expect(w.jobs[name].uses).toMatch(/^\.\/\.github\/workflows\//);
  for(const name of ['base-api-shards','base-api-exclusive','web-test-shards','chat-test-shards','fullstack-smoke','full-regression-core','e2e-full'])expect(w.jobs[name]).toBeDefined();
 });
 it('removes automatic heavy specialist/backend producers and automatic long-lived supervisor',()=>{
  for(const name of ['backend-gates','board-acceptance','skill-files-e2e','billing-cashier-glue']){const w=workflow(name);expect(w.on.pull_request).toBeUndefined();expect(w.on.merge_group).toBeUndefined();expect(w.on.workflow_call).toBeDefined();}
  expect(workflow('ci-fail-fast').on.workflow_run).toBeUndefined();
  expect(workflow('ci-pr-queue-plan').on.pull_request).toBeUndefined();
 });
});

it('selects reviewed database-free API unit configs for known high-risk runtime impact',()=>{
 const p=lightweightPlan(['apps/api/src/domain/auth/service.ts','apps/api/src/domain/chat/service.ts'],{sourceSha,baseSha,exists:()=>true});
 expect(p.apiUnitConfigs).toContain('vitest.usage-unit.config.ts');
 expect(p.apiUnitConfigs).toContain('vitest.chat-share-unit.config.ts');
});

import {changedPaths} from './ci-change-scope.mjs';
import {assertPrerequisites} from './ci-base-api.mjs';
it('treats schedule as full scope and enforces the actual scheduled API prerequisite set',()=>{
 expect(changedPaths({event:'schedule'})).toBeNull();
 const needs=Object.fromEntries(['base-api-plan','base-api-shards','base-api-exclusive','base-compile'].map(k=>[k,{result:'success'}]));
 expect(()=>assertPrerequisites(needs,'schedule')).not.toThrow();
 expect(()=>assertPrerequisites({...needs,'base-api-shards':{result:'skipped'}},'schedule')).toThrow();
});

import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
it('writes a full forced plan artifact on schedule instead of discarding its output path',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wsx-hourly-plan-'));
 try{const file=join(dir,'plan.json');execFileSync(process.execPath,['.harness/scripts/ci-targeted-ui.mjs','--full',file],{env:{...process.env,GITHUB_SHA:sourceSha,CI_SCOPE_BASE_SHA:sourceSha},stdio:'pipe'});expect(JSON.parse(readFileSync(file,'utf8')).mode).toBe('full');}finally{rmSync(dir,{recursive:true,force:true});}
});

it('the actual queue CLI binds repository, immutable checkout and positive run attempt before producing a lightweight receipt',()=>{
 const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const needs=Object.fromEntries(['verify-control-plane','verify-affected','verify-full-compile','merge-gate','backend-required'].map(n=>[n,{result:'success'}]));
 const env={...process.env,GITHUB_EVENT_NAME:'merge_group',GITHUB_REPOSITORY:'boardx/workspacex',GITHUB_REF:'refs/heads/gh-readonly-queue/develop/pr-1-'+baseSha,GITHUB_SHA:head,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',CI_SCOPE_BASE_SHA:baseSha,CI_QUEUE_NEEDS:JSON.stringify(needs),GITHUB_OUTPUT:undefined,GITHUB_STEP_SUMMARY:undefined};
 const run=(overrides:any)=>spawnSync(process.execPath,['.harness/scripts/ci-lightweight.mjs','queue'],{env:{...env,...overrides},encoding:'utf8'});
 expect(run({}).status).toBe(0);
 for(const override of [{GITHUB_RUN_ATTEMPT:'0'},{GITHUB_RUN_ATTEMPT:''},{GITHUB_REPOSITORY:'other/repo'},{GITHUB_SHA:sourceSha},{GITHUB_REF:'refs/heads/develop'}])expect(run(override).status).not.toBe(0);
});

it('selects known policy and CN source-admission companion tests before merge rather than deferring them as unknown impact',()=>{
 const p=lightweightPlan(['.harness/scripts/vm/cn-main-source-admission.mjs','.harness/scripts/lib/pr-queue.ts','.harness/scripts/lib/ci-hourly-reachability.mjs','.harness/scripts/hourly-regression-issues.mjs'],{sourceSha,baseSha,exists:()=>true});
 for(const file of ['.harness/scripts/vm/cn-main-source-admission.test.ts','.harness/scripts/lib/pr-queue.test.ts','.harness/scripts/lib/ci-hourly-reachability.test.ts','.harness/scripts/hourly-regression-issues.test.ts'])expect(p.unitFiles).toContain(file);
});
