import {describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {assertCoverage,identities,verifyResults,shardPlan,discoverCoverage,invoke,reportHash} from './ci-chat-shards.mjs';
describe('chat shard evidence',()=>{
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
  const result=spawnSync('bash',['-o','pipefail','-c',command],{cwd:root,env,encoding:'utf8',timeout:50000,maxBuffer:4*1024*1024});
  expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('[test-isolation]');
  const report=JSON.parse(readFileSync(resolve(temp,'shard/report.json'),'utf8'));
  expect(report.stats.expected).toBe(1);expect(report.stats.unexpected).toBe(0);
 }finally{rmSync(dir,{recursive:true,force:true});}
},60000);
