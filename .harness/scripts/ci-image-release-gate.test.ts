import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
it('all manual targets use the same artifact and installed-host gate',()=>{
 const w=parse(readFileSync('.github/workflows/image-release.yml','utf8'));
 expect(w.jobs.build.needs).toBe('plan');
 expect(w.jobs.admission).toBeUndefined();
 expect(w.jobs.deploy.needs).toEqual(['plan','build','manifest']);
 expect(w.jobs.deploy.if).toContain("github.event_name == 'workflow_dispatch'");
 expect(w.jobs.deploy.if).not.toContain("target == 'devapp'");
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
 expect(w.jobs.admission).toBeUndefined();
});

it('keeps installed standalone candidate policy generated from the admission contract',()=>{
 expect(()=>execFileSync(process.execPath,['.harness/scripts/gen-devapp-ci-policy.mjs','--check'])).not.toThrow();
});

it('allows explicit manual CN branch releases while retaining frozen source and installed deployment',()=>{
 const w=parse(readFileSync('.github/workflows/image-release.yml','utf8'));
 expect(w.jobs.plan.if).toContain("github.ref_type == 'branch'");
 expect(w.jobs.build.steps.filter((s:any)=>s.uses==='actions/checkout@v5').at(-1).with.ref).toBe('${{ needs.plan.outputs.source }}');
 expect(w.jobs.deploy.if).toContain("needs.manifest.result == 'success'");
 expect(w.jobs.deploy.if).toContain("needs.plan.outputs.build == 'false'");
 expect(w.jobs.deploy.steps.some((s:any)=>s.uses?.startsWith('actions/checkout'))).toBe(false);
});

it('retains strict application-only release typechecking without bundling API E2E fixtures',()=>{
 execFileSync('python3',['-B','-m','unittest','discover','-s','tests','-p','test_web_builder_imports.py'],{timeout:60_000});
});
