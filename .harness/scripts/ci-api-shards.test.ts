import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { assertCoverage, shardPlan, discoverCoverage } from './ci-api-shards.mjs';
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const policy=JSON.parse(read('../api-test-shards.json'));
const workflow=parse(read('../../.github/workflows/backend-gates.yml'));
describe('API isolated shard coverage',()=>{
 it('has one policy-driven workflow count without weakening isolated serial gates',()=>{
  const plan=shardPlan(policy),test=workflow.jobs['gates-test'];
  expect(plan.shards).toEqual(Array.from({length:plan.count},(_,i)=>i+1));
  expect(test.needs).toBe('api-test-plan');
  expect(test.strategy.matrix.shard).toBe('${{ fromJSON(needs.api-test-plan.outputs.shards) }}');
  expect(test.timeoutMinutes??test['timeout-minutes']).toBe(20);
  expect(test.strategy['fail-fast']).toBe(false);
  expect(test.env.WORKSPACEX_DB).toBe('wsx_ci_${{ github.run_id }}_test_${{ matrix.shard }}');
  const command=test.steps.find((step:any)=>step.run?.includes('vitest run')).run;
  expect(command).toBe('pnpm --filter api exec vitest run --shard=${{ matrix.shard }}/${{ needs.api-test-plan.outputs.count }}');
  expect(read('../../apps/api/vitest.config.ts')).toMatch(/maxWorkers:\s*1/);
  expect(read('../../apps/api/vitest.config.ts')).toMatch(/minWorkers:\s*1/);
  expect(workflow.jobs['gates-fast'].steps.some((step:any)=>step.run==='node .harness/scripts/ci-api-shards.mjs --verify')).toBe(true);
  for(const lane of ['native-document-chain','native-runtime-lane','gates-runtime','prototype-audit','design-loop-e2e'])expect(workflow.jobs['backend-required'].needs).toContain(lane);
  expect(test.steps.find((step:any)=>step.name==='清掉本次运行的数据库').if).toBe('always()');
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
