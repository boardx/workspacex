import {expect,it} from 'vitest';
import {requireQueueProtection,requireQueueResults} from './ci-queue-ready.mjs';
import {CURRENT_POLICY} from './lib/ci-check-policy.mjs';
import {skillAffected} from './ci-skill-scope.mjs';
const queue={type:'merge_queue',parameters:{grouping_strategy:'ALLGREEN',merge_method:'MERGE',max_entries_to_merge:1}};
const rules=[queue,{type:'required_status_checks',parameters:{required_status_checks:CURRENT_POLICY.requiredChecks.map(context=>({context}))}}];
it('requires live queue and all configured mandatory checks on the PR readiness path',()=>{
 expect(()=>requireQueueProtection(rules)).not.toThrow();
 for(const bad of [null,[],rules.slice(1),[queue],rules.concat(queue)])expect(()=>requireQueueProtection(bad)).toThrow();
 expect(()=>requireQueueProtection([{...queue,parameters:{...queue.parameters,grouping_strategy:'HEADGREEN'}},rules[1]])).toThrow();
});
it('actual queue acceptance rejects failure, cancellation, skipped and missing lanes',()=>{
 const good={'e2e-full':{result:'success'},'full-regression-core':{result:'success'}};
 expect(()=>requireQueueResults(good)).not.toThrow();
 for(const result of ['failure','cancelled','skipped',undefined])for(const name of Object.keys(good))expect(()=>requireQueueResults({...good,[name]:{result}})).toThrow();
 for(const bad of [null,{}, {...good,extra:{result:'success'}}])expect(()=>requireQueueResults(bad)).toThrow();
});
it('keeps Skill dependencies and unknown scope covered while skipping unrelated prose',()=>{
 expect(skillAffected(null)).toBe(true);
 for(const path of ['apps/web/a.ts','packages/contracts/a.ts','skills/a.md','.agents/a.md','patches/a.patch','pnpm-lock.yaml','.nvmrc'])expect(skillAffected([path])).toBe(true);
 expect(skillAffected(['docs/prose.md'])).toBe(false);
});
