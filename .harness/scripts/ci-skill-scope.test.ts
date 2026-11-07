import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
it('moves the real Skill browser to hourly/manual while preserving legacy scope helper behavior',()=>{
 const w=parse(readFileSync('.github/workflows/skill-files-e2e.yml','utf8'));
 for(const event of ['pull_request','merge_group']){
  expect(w.on[event]).toBeUndefined();
 }
 expect(w.on.push).toBeUndefined();
 expect(w.jobs['skill-files-e2e'].needs).toBe('scope');
 expect(w.jobs['skill-files-e2e'].if).toBe("needs.scope.outputs.changed == 'true'");
 expect(w.jobs.scope.steps.find((s:any)=>s.id==='scope').run).toBe("echo 'changed=true' >> \"$GITHUB_OUTPUT\"");expect(Object.hasOwn(w.on,'workflow_call')).toBe(true);const full=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8'));expect(full.jobs['skill-full'].uses).toBe('./.github/workflows/skill-files-e2e.yml');expect(full.jobs['hourly-full-result'].needs).toContain('skill-full');
 expect(Object.hasOwn(w.on,'workflow_dispatch')).toBe(true);
 expect(w.jobs['skill-files-e2e'].steps.some((s:any)=>s.run?.includes('studio-skill-files-e2e.mjs'))).toBe(true);
});

import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync as read,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
it('publishes the actual CLI result to GitHub output, not just console text',()=>{
 const dir=mkdtempSync(join(tmpdir(),'skill-scope-'));
 try{
  const output=join(dir,'out');
  execFileSync(process.execPath,['.harness/scripts/ci-skill-scope.mjs'],{env:{...process.env,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_OUTPUT:output}});
  expect(read(output,'utf8')).toBe('changed=true\n');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it('a missing comparison base fails instead of publishing an empty/false selection',()=>{
 const dir=mkdtempSync(join(tmpdir(),'skill-scope-'));
 try{
  const output=join(dir,'out');
  const child=spawnSync(process.execPath,['.harness/scripts/ci-skill-scope.mjs'],{env:{...process.env,GITHUB_EVENT_NAME:'merge_group',CI_SCOPE_BASE_SHA:'',GITHUB_OUTPUT:output},encoding:'utf8'});
  expect(child.status).not.toBe(0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
