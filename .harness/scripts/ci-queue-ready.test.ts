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

import {specialistSpecs,waitForSpecialists} from './ci-queue-ready.mjs';
it('requires selected specialist tests while keeping scope producers mandatory',()=>{
 expect(specialistSpecs(['docs/a.md']).every(s=>s.checks.join()==='scope')).toBe(true);
 expect(specialistSpecs(['apps/web/app/billing/page.tsx']).find(s=>s.workflowPath.includes('billing'))?.checks).toContain('billing-cashier-glue');
 expect(specialistSpecs(['apps/web/components/whiteboard/a.ts']).find(s=>s.workflowPath.includes('board-acceptance'))?.checks).toContain('journeys');
});
it('refreshes bounded API clients across a specialist wait longer than 90 seconds',async()=>{
 let now=0,clients=0;
 const sha='a'.repeat(40),paths=['docs/a.md'];
 const apiFactory=()=>{
  clients++;const started=now;let workflowPath='';
  return async(path:string)=>{
   if(now-started>90000)throw Error('lookup_deadline_exceeded');
   if(path.startsWith('/actions/workflows/')&&!path.includes('/runs?')){workflowPath='.github/workflows/'+path.split('/').at(-1);return{id:7,path:workflowPath,state:'active'};}
   const run={id:20,workflow_id:7,path:workflowPath,head_sha:sha,head_branch:'gh-readonly-queue/develop/pr-6059-'+ 'b'.repeat(40),event:'merge_group',run_attempt:1,created_at:'2026-10-31T00:00:00Z',status:'completed',conclusion:'success'};
   if(path.includes('/runs?'))return{total_count:now<120000?0:1,workflow_runs:now<120000?[]:[run]};
   if(path.includes('/jobs?'))return{total_count:1,jobs:[{name:'scope',run_id:20,run_attempt:1,head_sha:sha,status:'completed',conclusion:'success'}]};
   return run;
  };
 };
 await waitForSpecialists({apiFactory,sha,paths,clock:()=>now,sleep:async(ms:number)=>{now+=ms;},budgetMs:180000});
 expect(now).toBe(120000);expect(clients).toBe(27);
});
it('requires matching plan-bound routed aggregate metadata on the new queue path',()=>{
 const good=mode=>Object.fromEntries(['e2e-full','full-regression-core'].map(name=>[name,{result:'success',outputs:{verification_mode:mode,plan_digest:'a'.repeat(64)}}]));
 for(const mode of ['full','targeted-ui'])expect(requireQueueResults(good(mode),{routed:true}).mode).toBe(mode);
 for(const outputs of [{},{verification_mode:'candidate-ui',plan_digest:'a'.repeat(64)},{verification_mode:'full',plan_digest:'old'}]){
  const x=good('targeted-ui');x['e2e-full'].outputs=outputs;expect(()=>requireQueueResults(x,{routed:true})).toThrow();
 }
});
