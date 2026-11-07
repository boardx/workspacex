import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { assertCoverage, shardPlan, discoverCoverage } from './ci-api-shards.mjs';
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const policy=JSON.parse(read('../api-test-shards.json'));
const workflow=parse(read('../../.github/workflows/backend-gates.yml'));
describe('API isolated shard coverage',()=>{
 it.each(['gates-runtime','gates-test'])('checks out only the event-selected current source for %s',(job)=>{
  const runtime=workflow.jobs[job];
  const checkout=runtime.steps.find((step:any)=>step.uses?.startsWith('actions/checkout@'));
  expect(checkout.with['fetch-depth']).toBe(1);
  expect(checkout.with['fetch-tags']).toBe(false);
  expect(checkout.with.ref).toBeUndefined();
  expect(checkout.with.repository).toBeUndefined();
 });
 it('has one policy-driven workflow count without weakening isolated serial gates',()=>{
  const plan=shardPlan(policy),test=workflow.jobs['gates-test'];
  expect(plan.shards).toEqual(Array.from({length:plan.count},(_,i)=>i+1));
  expect(test.needs).toBe('api-test-plan');
  expect(test.strategy.matrix.shard).toBe("${{ fromJSON(github.event_name == 'merge_group' && '[1]' || needs.api-test-plan.outputs.shards) }}");
  expect(test.timeoutMinutes??test['timeout-minutes']).toBe("${{ github.event_name == 'merge_group' && 45 || 20 }}");
  expect(test.strategy['fail-fast']).toBe(true);
  expect(test.env.WORKSPACEX_DB).toBe('wsx_ci_${{ github.run_id }}_test_${{ matrix.shard }}');
  const command=test.steps.find((step:any)=>step.run?.includes('vitest run')).run;
  expect(command).toBe('pnpm --filter api exec vitest run --shard=${{ matrix.shard }}/${{ needs.api-test-plan.outputs.count }} --bail=1');
  expect(read('../../apps/api/vitest.config.ts')).toMatch(/maxWorkers:\s*1/);
  expect(read('../../apps/api/vitest.config.ts')).toMatch(/minWorkers:\s*1/);
  expect(workflow.jobs['gates-fast'].steps.some((step:any)=>step.run==='node .harness/scripts/ci-api-shards.mjs --verify')).toBe(true);
  for(const lane of ['native-document-chain','native-runtime-lane','gates-runtime','prototype-audit','design-loop-e2e'])expect(workflow.jobs['backend-required'].needs).toContain(lane);
  expect(test.steps.find((step:any)=>step.name==='清掉本次运行的数据库').if).toBe("always() && github.event_name != 'merge_group'");
 });
 it.each([{schemaVersion:1,count:0},{schemaVersion:1,count:1.5},{schemaVersion:1,count:33},{schemaVersion:2,count:8},{schemaVersion:1,count:8,extra:true}])('rejects invalid policy %j',(input)=>expect(()=>shardPlan(input)).toThrow());
 it('accepts a disjoint exact full union',()=>expect(assertCoverage(['a','b','c'],[['b'],['a','c']]).counts).toEqual([1,2]));
 it.each([[[['a'],['a','b']],'DUPLICATE_SHARD_FILE'],[[['a']],'MISSING_SHARD_FILE'],[[['a'],['b','x']],'UNEXPECTED_SHARD_FILE'],[[['a','b'],[]],'EMPTY_SHARD']])('rejects incomplete or overlapping partitions',(partitions:any,code:any)=>expect(()=>assertCoverage(['a','b'],partitions)).toThrow(code));
 it('verifies actual complete Vitest discovery using the installed sequencer',async()=>{
  const result=await discoverCoverage(shardPlan(policy));
  expect(result.shards).toBe(policy.count);expect(result.files).toBeGreaterThan(0);
  expect(result.counts.reduce((a:number,b:number)=>a+b,0)).toBe(result.files);
 },30000);
});

it('preserves two real workspace projects sharing the same module through disjoint shards',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'wsx-api-project-discovery-'));
 try {
  const configFile=join(directory,'vitest.config.ts');
  writeFileSync(configFile,'export default {test:{maxWorkers:1,minWorkers:1}}');
  writeFileSync(join(directory,'vitest.workspace.mjs'),"export default [{test:{name:'alpha',root:"+JSON.stringify(directory)+",include:['shared.test.ts']}},{test:{name:'beta',root:"+JSON.stringify(directory)+",include:['shared.test.ts']}}];");
  writeFileSync(join(directory,'shared.test.ts'),"throw new Error('discovery must never execute tests');");
  const result=await discoverCoverage(shardPlan({schemaVersion:1,count:2}),directory,configFile);
  expect(result.files).toBe(2);expect(result.counts).toEqual([1,1]);
  expect(()=>assertCoverage([{file:'shared.test.ts',projectName:'alpha'},{file:'shared.test.ts',projectName:'beta'}],[[{file:'shared.test.ts',projectName:'alpha'}],[{file:'shared.test.ts',projectName:'alpha'}]])).toThrow('DUPLICATE_SHARD_FILE');
 } finally {rmSync(directory,{recursive:true,force:true});}
},30000);

const exclusiveCommand='pnpm --filter @repo/api exec vitest run --config vitest.exclusive.config.ts --no-file-parallelism --maxWorkers=1 --minWorkers=1 --bail=1';
function assertRequiredExclusive(jobs:any){
 const runtime=jobs['gates-runtime'],steps=runtime.steps;
 expect(jobs['backend-required'].needs).toContain('gates-runtime');
 expect(runtime['timeout-minutes']).toBe(15);
 expect(runtime.env.WORKSPACEX_DB).toBe('wsx_ci_${{ github.run_id }}_runtime');
 const index=steps.findIndex((step:any)=>step.run===exclusiveCommand);
 const migration=steps.findIndex((step:any)=>step.run==='pnpm --filter api run migrate:check');
 expect(migration).toBeGreaterThanOrEqual(0);expect(index).toBeGreaterThan(migration);
 expect(index).toBeLessThan(steps.findIndex((step:any)=>step.name==='清掉本次运行的数据库'));
 expect(steps[index].if).toBeUndefined();expect(steps[index]['continue-on-error']).toBeUndefined();
 expect(runtime['continue-on-error']).toBeUndefined();
 expect(steps.find((step:any)=>step.name==='清掉本次运行的数据库').if).toBe('always()');
}
it('makes exclusive API collection a serial nonoptional step of an existing required job',()=>{
 assertRequiredExclusive(workflow.jobs);
 for(const mutate of [
  (jobs:any)=>{jobs['gates-runtime'].steps=jobs['gates-runtime'].steps.filter((step:any)=>step.run!==exclusiveCommand);},
  (jobs:any)=>{jobs['gates-runtime'].steps.find((step:any)=>step.run===exclusiveCommand).if='false';},
  (jobs:any)=>{jobs['gates-runtime'].steps.find((step:any)=>step.run===exclusiveCommand)['continue-on-error']=true;},
  (jobs:any)=>{jobs['backend-required'].needs=jobs['backend-required'].needs.filter((name:string)=>name!=='gates-runtime');},
 ]){const broken=JSON.parse(JSON.stringify(workflow.jobs));mutate(broken);expect(()=>assertRequiredExclusive(broken)).toThrow();}
});
it('actually collects exclusive files once and rejects both missing exclusion and missing exclusive include',()=>{
 const apiRoot=fileURLToPath(new URL('../../apps/api/',import.meta.url));
 const directory=mkdtempSync(join(apiRoot,'.vitest-exclusive-discovery-'));
 const deadline=Date.now()+25000;
 const expected=['tests/recording/personal-transcription-persistence.test.ts','tests/billing/native-credit-tariff-pg.test.ts','tests/billing/global-native-force-replay-pg.test.ts','tests/billing/member-credit-quota-replay-pg.test.ts'];
 const list=(config:string,label:string)=>{
  const output=join(directory,label+'.json');
  const remaining=deadline-Date.now();if(remaining<=0)throw new Error('EXCLUSIVE_DISCOVERY_DEADLINE');
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs',import.meta.url)),'list','--filesOnly','--config',config,'--json='+output],{cwd:apiRoot,encoding:'utf8',timeout:remaining});
  expect(result.error,label).toBeUndefined();expect(result.status,result.stderr).toBe(0);
  const rows=JSON.parse(readFileSync(output,'utf8'));expect(Array.isArray(rows)).toBe(true);
  return rows.map((row:{file:string})=>relative(apiRoot,row.file));
 };
 const verify=(normal:string[],exclusive:string[])=>{
  expect(normal.length).toBeGreaterThan(100);
  for(const file of expected)expect(normal).not.toContain(file);
  expect([...exclusive].sort()).toEqual([...expected].sort());
 };
 try{
  const normal=list(join(apiRoot,'vitest.config.ts'),'default'),exclusive=list(join(apiRoot,'vitest.exclusive.config.ts'),'exclusive');
  verify(normal,exclusive);
  const defaultSource=read('../../apps/api/vitest.config.ts');
  const brokenDefault=defaultSource.replace('"tests/billing/global-native-force-replay-pg.test.ts", ','').replace('"tests/billing/native-credit-tariff-pg.test.ts", ','');
  expect(brokenDefault).not.toBe(defaultSource);
  const defaultConfig=join(directory,'broken-default.config.ts');writeFileSync(defaultConfig,brokenDefault);
  const badNormal=list(defaultConfig,'broken-default');expect(badNormal).toContain(expected[1]);expect(badNormal).toContain(expected[2]);
  expect(()=>verify(badNormal,exclusive)).toThrow();
  const exclusiveSource=read('../../apps/api/vitest.exclusive.config.ts');
  const brokenExclusive=exclusiveSource.replace('tests/billing/global-native-force-replay-pg.test.ts','tests/billing/absent-force-replay.test.ts');
  expect(brokenExclusive).not.toBe(exclusiveSource);
  const exclusiveConfig=join(directory,'broken-exclusive.config.ts');writeFileSync(exclusiveConfig,brokenExclusive);
  const badExclusive=list(exclusiveConfig,'broken-exclusive');expect(badExclusive).not.toContain(expected[2]);
  expect(()=>verify(normal,badExclusive)).toThrow();
 }finally{rmSync(directory,{recursive:true,force:true});}
},30000);
