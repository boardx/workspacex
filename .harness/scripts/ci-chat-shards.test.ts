import {describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {assertCoverage,identities,verifyResults,shardPlan,discoverCoverage,invoke,reportHash,invocationEnvironment} from './ci-chat-shards.mjs';
describe('chat shard evidence',()=>{
 it('strips only discovery runtime flags while preserving the runtime input object',()=>{
  const input=Object.freeze({WSX_CHAT_REFRESH_PRODUCTION_WEB:'1',WSX_CHAT_REFRESH_DIAGNOSTICS:'1',OTHER:'kept'});
  expect(invocationEnvironment(true,input)).toEqual({OTHER:'kept'});
  expect(invocationEnvironment(false,input)).toBe(input);
  expect(input).toEqual({WSX_CHAT_REFRESH_PRODUCTION_WEB:'1',WSX_CHAT_REFRESH_DIAGNOSTICS:'1',OTHER:'kept'});
 });
 it('discovers with inherited production flags and no isolation id without changing runtime execution',()=>{
  const dir=mkdtempSync(resolve('apps/web','.chat-discovery-env-'));
  const keys=['WSX_CHAT_REFRESH_PRODUCTION_WEB','WSX_CHAT_REFRESH_DIAGNOSTICS','WORKSPACEX_ISOLATION_ID'];
  const original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try{
   process.env.WSX_CHAT_REFRESH_PRODUCTION_WEB='1';process.env.WSX_CHAT_REFRESH_DIAGNOSTICS='1';delete process.env.WORKSPACEX_ISOLATION_ID;
   writeFileSync(resolve(dir,'playwright.config.ts'),`import {defineConfig} from '@playwright/test';if(process.argv.includes('--list')&&(process.env.WSX_CHAT_REFRESH_PRODUCTION_WEB||process.env.WSX_CHAT_REFRESH_DIAGNOSTICS))throw Error('RUNTIME_FLAG_LEAKED_IN_DISCOVERY');export default defineConfig({testDir:'.',workers:1});`);
   writeFileSync(resolve(dir,'environment.spec.ts'),`import {test,expect} from '@playwright/test';test('runtime flags remain present',()=>{expect(process.env.WSX_CHAT_REFRESH_PRODUCTION_WEB).toBe('1');expect(process.env.WSX_CHAT_REFRESH_DIAGNOSTICS).toBe('1');expect(process.env.WORKSPACEX_ISOLATION_ID).toBeUndefined();});`);
   const options={cwd:resolve('apps/web'),config:resolve(dir,'playwright.config.ts')};
   // The old inherited --list environment must fail for the actual leak guard,
   // independently of the adapter. No webServer or browser fixture is involved.
   const negative=spawnSync('pnpm',['exec','playwright','test','--config',options.config,'--list'],{cwd:options.cwd,env:{...process.env},encoding:'utf8',timeout:30000});
   expect(negative.status).not.toBe(0);expect(negative.stderr+negative.stdout).toContain('RUNTIME_FLAG_LEAKED_IN_DISCOVERY');
   const coverage=discoverCoverage(shardPlan({schemaVersion:1,count:1}),options);
   expect(coverage.tests).toBe(1);expect(coverage.counts).toEqual([1]);
   const runtime=invoke(null,1,false,options);expect(runtime.status).toBe(0);expect(runtime.report.stats.expected).toBe(1);
   expect(Object.fromEntries(keys.map(key=>[key,process.env[key]]))).toEqual({WSX_CHAT_REFRESH_PRODUCTION_WEB:'1',WSX_CHAT_REFRESH_DIAGNOSTICS:'1',WORKSPACEX_ISOLATION_ID:undefined});
  }finally{for(const key of keys){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}rmSync(dir,{recursive:true,force:true});}
 },60000);
 it('preserves the original chat-read project boundary',()=>{
  const coverage=discoverCoverage(shardPlan({schemaVersion:1,count:2}));
  expect(coverage.full.length).toBeGreaterThan(0);
  expect([...new Set(coverage.full.map(id=>JSON.parse(id)[0]))]).toEqual(['chat-read']);
 },30000);
 it('rejects missing and duplicate partitions',()=>{expect(()=>assertCoverage(['a','b'],[['a'],['a']])).toThrow();expect(()=>assertCoverage(['a','b'],[['a']])).toThrow();});
 it('bounds fanout',()=>expect(shardPlan({schemaVersion:1,count:2}).shards).toEqual([1,2]));
 it('uses installed Playwright discovery and browserless execution with independent projects',()=>{
  const dir=mkdtempSync(resolve('apps/web','.chat-shard-fixture-'));
  try {
   const marker=resolve(dir,'SERVER_STARTED');
   writeFileSync(resolve(dir,'playwright.config.ts'),`import {defineConfig} from '@playwright/test'; export default defineConfig({testDir:'.',fullyParallel:false,workers:1,projects:[{name:'alpha'},{name:'beta'}],webServer:{command:'touch ${marker}; exit 1',port:18999}});`);
   for(const name of ['a','b']) writeFileSync(resolve(dir,`${name}.spec.ts`),`import {test,expect} from '@playwright/test'; test('same',()=>expect(1).toBe(1)); test.skip('declared skip',()=>{}); test.fail('expected fail',()=>expect(1).toBe(2));`);
   const options={cwd:resolve('apps/web'),config:resolve(dir,'playwright.config.ts')};
   const plan=shardPlan({schemaVersion:1,count:2}),coverage=discoverCoverage(plan,options);
   expect(coverage.tests).toBe(12); expect(existsSync(marker)).toBe(false);
   // Drop webServer for real execution: tests have no browser fixture.
   writeFileSync(resolve(dir,'playwright.config.ts'),`import {defineConfig} from '@playwright/test'; export default defineConfig({testDir:'.',fullyParallel:false,workers:1,projects:[{name:'alpha'},{name:'beta'}]});`);
   const identity={sha:'abc',runId:'1',attempt:'2'};
   const results=plan.shards.map(shard=>{const {report,status}=invoke(shard,2,false,options);return {...identity,shard,status,report,reportHash:reportHash(report),discoverySha256:coverage.discoverySha256,stats:report.stats,identities:identities(report)};});
   expect(verifyResults(results,coverage,identity)).toBe(true);
   const runtimeSkip=structuredClone(results); const find=suites=>{for(const suite of suites??[]){for(const spec of suite.specs??[])for(const t of spec.tests??[])if(t.expectedStatus==='passed')return t;const found=find(suite.suites);if(found)return found;}};const changed=find(runtimeSkip[0].report.suites);changed.expectedStatus='skipped';changed.status='skipped';changed.results=[{status:'skipped'}];runtimeSkip[0].reportHash=reportHash(runtimeSkip[0].report);runtimeSkip[0].identities=identities(runtimeSkip[0].report);expect(()=>verifyResults(runtimeSkip,coverage,identity)).toThrow();
   expect(()=>verifyResults([],coverage,identity)).toThrow();
   expect(()=>verifyResults([results[0],results[0]],coverage,identity)).toThrow();
   for(const patch of [{sha:'wrong'},{runId:'wrong'},{attempt:'1'},{discoverySha256:'wrong'},{reportHash:'wrong'},{status:1},{identities:[]},{stats:{expected:0,unexpected:0,skipped:1,flaky:0}}]) expect(()=>verifyResults([{...results[0],...patch},results[1]],coverage,identity)).toThrow();
   writeFileSync(resolve(dir,'a.spec.ts'),`import {test,expect} from '@playwright/test'; test('same',()=>expect(1).toBe(2));`);
   const failed=invoke(null,2,false,options);expect(failed.status).not.toBe(0);expect(failed.report.stats.unexpected).toBeGreaterThan(0);
  } finally {rmSync(dir,{recursive:true,force:true});}
 },120000);
});

import {readFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';
import {deriveTestIsolation} from './lib/test-isolation';
it('keeps real isolation-wrapper stdout out of the Playwright JSON report',()=>{
 const root=resolve('.'),dir=mkdtempSync(resolve('apps/web','.chat-json-boundary-'));
 try{
  writeFileSync(resolve(dir,'playwright.config.ts'),`import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'.',workers:1,projects:[{name:'fixture'}]});`);
  writeFileSync(resolve(dir,'actual.spec.ts'),`import {test,expect} from '@playwright/test';test('actual wrapper child',()=>expect(1).toBe(1));`);
  const step=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8')).jobs['chat-test-shards'].steps.find((s:any)=>s.run?.includes('with-test-isolation.ts'));
  const temp=resolve(dir,'artifacts');mkdirSync(resolve(temp,'shard'),{recursive:true});
  const isolation=deriveTestIsolation({worktreePath:root,isolationId:dir});
  const env={...process.env,...isolation,WORKSPACEX_VERIFY_OUTER_DB:undefined,WORKSPACEX_VERIFY_OUTER_COMPOSE:undefined,WORKSPACEX_KEEP_TEST_STACK:undefined,RUNNER_TEMP:temp,CI_JSON_FIXTURE_CONFIG:resolve(dir,'playwright.config.ts')};delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;
  for(const [key,value]of Object.entries(step.env??{}))env[key]=String(value).replaceAll('${{ runner.temp }}',temp);
  const command=step.run.split('\n').find((line:string)=>line.includes('with-test-isolation.ts')).trim()
   .replaceAll('${{ matrix.shard }}','1').replaceAll('${{ needs.chat-test-plan.outputs.count }}','1')
   .replace('--config playwright.chat-read.config.ts','--config "$CI_JSON_FIXTURE_CONFIG"').replace('--project=chat-read','--project=fixture')
   .replaceAll('phases/phase-01-run-a-project/evidence/ci/chat-read.log','"$RUNNER_TEMP/fixture.log"');
  expect(command).not.toContain('${{');
  // This counterexample tests real isolation stdout versus the JSON reporter,
  // not the CI-only production build. Keep its child explicitly browserless.
  const builder='pnpm exec tsx apps/web/e2e/support/chat-refresh-production-build.ts';
  expect(command).toContain(builder);
  const browserlessCommand=command.replace(builder,'pnpm --filter web exec playwright test');
  expect(browserlessCommand).not.toContain('chat-refresh-production-build.ts');
  expect(browserlessCommand).toContain('--config "$CI_JSON_FIXTURE_CONFIG"');
  delete env.WSX_CHAT_REFRESH_PRODUCTION_WEB;
  delete env.WSX_CHAT_REFRESH_DIAGNOSTICS;
  const result=spawnSync('bash',['-o','pipefail','-c',browserlessCommand],{cwd:root,env,encoding:'utf8',timeout:50000,maxBuffer:4*1024*1024});
  expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('[test-isolation]');
  const report=JSON.parse(readFileSync(resolve(temp,'shard/report.json'),'utf8'));
  expect(report.stats.expected).toBe(1);expect(report.stats.unexpected).toBe(0);
 }finally{rmSync(dir,{recursive:true,force:true});}
},60000);
