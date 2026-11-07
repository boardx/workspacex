import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
for (const [file, job, event] of [
  ['backend-gates', 'backend-required', 'pull_request'],
  ['harness-acceptance', 'e2e-full', 'push'],
]) {
  describe(`${file==='backend-gates'?'historical v4 ':'hourly '}${job} cancellation boundary`, () => {
    const workflow = file==='backend-gates'?JSON.parse(readFileSync(resolve(root,'.harness/scripts/fixtures/backend-gates-v4.json'),'utf8')):parse(readFileSync(resolve(root, `.github/workflows/${file}.yml`), 'utf8'));
    const condition = workflow.jobs[job].if;
    // Evaluate the actual checked-in boolean expression; not a GitHub runner simulation.
    const evaluate = (cancelled: boolean, eventName = event, full = true) =>
      new Function('always', 'cancelled', 'github', 'inputs', `return (${condition});`)(
        () => true, () => cancelled, { event_name: eventName }, { run_e2e_full: full },
      );
    it('does not schedule a final runner after whole-workflow cancellation', () => {
      expect(evaluate(true)).toBe(false);
    });
    it('still runs after an ordinary dependency failure when workflow is not cancelled', () => {
      // An explicit status function avoids GitHub implicit success() suppressing failed dependencies.
      expect(condition).toContain('always()');
      expect(evaluate(false)).toBe(true);
    });
    if (job === 'e2e-full') {
      it('preserves explicit manual full-verification selection', () => {
        expect(evaluate(false, 'workflow_dispatch', true)).toBe(true);
        expect(evaluate(false, 'workflow_dispatch', false)).toBe(false);
        expect(evaluate(true, 'workflow_dispatch', true)).toBe(false);
        expect(evaluate(false, 'pull_request')).toBe(false);
      });
    } else {
      it('does not add a backend merge aggregate to deployment events', () => {
        expect(evaluate(false, 'push')).toBe(false);
        expect(evaluate(false, 'workflow_dispatch')).toBe(false);
      });
    }
  });
}

import {requireLightweightResults} from './ci-lightweight.mjs';
import {requireHourlyResults} from './ci-hourly-result.mjs';
it('current v5 terminal aggregates converge on failure/cancellation while rejecting every incomplete producer set',()=>{
 const merge=parse(readFileSync(resolve(root,'.github/workflows/harness-verify.yml'),'utf8'));
 const queue=merge.jobs['queue-ready'];expect(queue.if).toBe("always() && (github.event_name == 'merge_group' || !cancelled())");expect(queue.needs).toHaveLength(5);expect(JSON.stringify(queue.steps)).toContain('ci-lightweight.mjs queue');
 const results=Object.fromEntries(queue.needs.map((name:string)=>[name,{result:'success'}]));
 for(const name of queue.needs)for(const result of ['failure','cancelled','skipped',undefined])expect(()=>requireLightweightResults({...results,[name]:{result}},{sourceSha:'a'.repeat(40),baseSha:'b'.repeat(40)})).toThrow();
 const full=parse(readFileSync(resolve(root,'.github/workflows/harness-acceptance.yml'),'utf8'));expect(full.jobs['hourly-full-result'].if).toContain('always()');expect(()=>requireHourlyResults({}, {expected:full.jobs['hourly-full-result'].needs,sha:'a'.repeat(40)})).toThrow();
});

it('releases superseded PR runs while merge-group terminal verdicts survive cancellation and dependency failure',()=>{
 const workflow=parse(readFileSync(resolve(root,'.github/workflows/harness-verify.yml'),'utf8'));
 const condition=workflow.jobs['queue-ready'].if;
 const runs=(event_name:string,cancelled:boolean)=>Function('always','cancelled','github',`return (${condition})`)(()=>true,()=>cancelled,{event_name});
 expect(runs('pull_request',false)).toBe(true);
 expect(runs('pull_request',true)).toBe(false);
 for(const cancelled of [false,true]){
  expect(runs('merge_group',cancelled)).toBe(true);
  for(const result of ['failure','cancelled','skipped',undefined]){
   const needs=Object.fromEntries(workflow.jobs['queue-ready'].needs.map((name:string)=>[name,{result:'success'}]));needs['verify-affected']={result};
   expect(()=>requireLightweightResults(needs,{sourceSha:'a'.repeat(40),baseSha:'b'.repeat(40)})).toThrow();
  }
 }
});
