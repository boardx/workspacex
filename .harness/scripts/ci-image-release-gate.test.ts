import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
it('builds in parallel but never activates automatic devapp before exact-source admission',()=>{
 const w=parse(readFileSync('.github/workflows/image-release.yml','utf8'));
 expect(w.jobs.build.needs).toBe('plan');
 expect(w.jobs.admission.needs).toBe('plan');
 expect(w.jobs.admission.permissions).toEqual({contents:'read',actions:'read'});
 expect(w.jobs.admission.steps.some((s:any)=>s.run==='node .harness/scripts/ci-devapp-integration-gate.mjs')).toBe(true);
 expect(w.jobs.deploy.needs).toContain('admission');
 expect(w.jobs.deploy.if).toContain("needs.admission.result == 'success'");
 expect(w.jobs.deploy.if).toContain("needs.plan.outputs.target != 'devapp'");
 expect(w.jobs.deploy.steps.at(-1).run).toContain('/usr/local/bin/workspacex-image-release');
});

import {assertReleaseSource} from './ci-devapp-integration-gate.mjs';
it('never uses current branch verification to admit an existing Devapp tag of unknown source',()=>{
 const source={event:'workflow_dispatch',ref:'refs/heads/develop',sha:'a'.repeat(40),tag:''};
 expect(()=>assertReleaseSource(source)).not.toThrow();
 expect(()=>assertReleaseSource({...source,event:'push'})).not.toThrow();
 expect(()=>assertReleaseSource({...source,tag:'older-release'})).toThrow('TAG_SOURCE_UNVERIFIED');
 expect(()=>assertReleaseSource({...source,ref:'refs/heads/main'})).toThrow('SOURCE_REQUIRED');
 expect(()=>assertReleaseSource({...source,sha:''})).toThrow('SOURCE_REQUIRED');
 const w=parse(readFileSync('.github/workflows/image-release.yml','utf8'));
 expect(w.jobs.admission.steps.at(-1).env.CI_RELEASE_TAG).toBe('${{ inputs.tag }}');
});

it('keeps installed standalone candidate policy generated from the admission contract',()=>{
 expect(()=>execFileSync(process.execPath,['.harness/scripts/gen-devapp-ci-policy.mjs','--check'])).not.toThrow();
});
