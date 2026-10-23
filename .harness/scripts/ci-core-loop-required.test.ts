import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
it('uses the same core-loop acceptance for required merge gate and deployment',()=>{
 const w=parse(readFileSync('.github/workflows/backend-gates.yml','utf8'));
 const p=JSON.parse(readFileSync('.harness/config/ci-check-policy.json','utf8'));
 expect(p.requiredChecks).toContain('backend-required');
 expect(p.aggregates['backend-required']).toContain('e2e-core-loop');
 expect(w.jobs['backend-required'].needs).toContain('e2e-core-loop');
 expect(w.jobs.deploy.needs).toContain('e2e-core-loop');
 expect(w.jobs['e2e-core-loop']['continue-on-error']).toBeUndefined();
});
import {aggregateFailures,CURRENT_POLICY} from './lib/ci-check-policy.mjs';
it('rejects failed, missing, cancelled and skipped core-loop without a second execution',()=>{
 const members=CURRENT_POLICY.aggregates['backend-required'];
 const results=Object.fromEntries(members.map((name:string)=>[name,{result:'success'}]));
 expect(aggregateFailures('backend-required',results)).toEqual([]);
 for(const result of ['failure','cancelled','skipped',undefined]){
  expect(aggregateFailures('backend-required',{...results,'e2e-core-loop':{result}})).toContain('e2e-core-loop');
 }
});
