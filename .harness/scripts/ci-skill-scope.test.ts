import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
it('limits optional Skill browser workflow to source/dependency changes and preserves manual entry',()=>{
 const w=parse(readFileSync('.github/workflows/skill-files-e2e.yml','utf8'));
 for(const event of ['pull_request','merge_group']){
  expect(w.on[event].branches).toEqual(['develop']);
  expect(w.on[event].paths).toBeUndefined();
 }
 expect(w.on.push).toBeUndefined();
 expect(w.jobs['skill-files-e2e'].needs).toBe('scope');
 expect(w.jobs['skill-files-e2e'].if).toBe("needs.scope.outputs.changed == 'true'");
 expect(w.jobs.scope.steps.find((s:any)=>s.id==='scope')).toMatchObject({run:'node .harness/scripts/ci-skill-scope.mjs',env:{CI_SCOPE_BASE_SHA:'${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha }}'}});
 expect(Object.hasOwn(w.on,'workflow_dispatch')).toBe(true);
 expect(w.jobs['skill-files-e2e'].steps.some((s:any)=>s.run?.includes('studio-skill-files-e2e.mjs'))).toBe(true);
});
