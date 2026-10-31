import {expect,it} from 'vitest';
import {planImpact} from './ci-test-plan.mjs';
it('selects local billing without unrelated chat',()=>{const p=planImpact(['apps/web/app/billing/page.tsx']);expect(p.mode).toBe('targeted');expect(p.suites).toContain('billing');expect(p.suites).not.toContain('chat');});
it.each(['packages/contracts/src/billing.ts','pnpm-lock.yaml','.github/workflows/a.yml','unknown/a.ts'])('expands uncertain or shared input %s',path=>expect(planImpact([path]).mode).toBe('full'));
it('keeps permissions mandatory and resolves dependencies',()=>{const p=planImpact(['apps/api/src/application/billing/a.ts']);expect(p.suites).toContain('identity');expect(p.reasons.length).toBeGreaterThan(0);});
it('has stable identities independent of diff order',()=>expect(planImpact(['docs/a.md','apps/web/app/billing/a.ts']).policyDigest).toBe(planImpact(['apps/web/app/billing/a.ts','docs/a.md']).policyDigest));
it('rejects empty and unsafe inputs rather than reporting success',()=>{for(const paths of [[],['../a'],['/a']])expect(()=>planImpact(paths)).toThrow();});

import {gitPlan} from './ci-test-plan.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
it('propagates an actual identity change to consumers',()=>expect(planImpact(['apps/api/src/domain/identity/a.ts']).affectedModules).toEqual(['billing','chat','identity']));
it('uses actual commit diffs including rename and rejects absent bases',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ci-impact-'));const git=(args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8'});
 try{
  git(['init','-q']);git(['config','user.name','CI fixture']);git(['config','user.email','ci@example.test']);
  mkdirSync(join(dir,'docs'));writeFileSync(join(dir,'docs/a.md'),'a');git(['add','.']);git(['commit','-qm','base']);const base=git(['rev-parse','HEAD']).trim();
  renameSync(join(dir,'docs/a.md'),join(dir,'code.ts'));git(['add','-A']);git(['commit','-qm','rename']);const head=git(['rev-parse','HEAD']).trim();
  const plan=gitPlan(base,head,git);expect(plan.changedFiles).toEqual(['code.ts','docs/a.md']);expect(plan.mode).toBe('full');expect(plan.planDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(()=>gitPlan('0'.repeat(40),head,git)).toThrow();expect(()=>gitPlan(head,base,git)).toThrow();expect(()=>gitPlan(base,base,git)).toThrow();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
it('binds the actual policy bytes and expands migrations and unclassified UI',()=>{
 const policy=readFileSync('.harness/config/ci-test-impact.json','utf8');
 expect(planImpact(['docs/a.md'],policy).policyDigest).not.toBe(planImpact(['docs/a.md'],policy+'\n').policyDigest);
 for(const path of ['apps/api/migrations/001.sql','apps/web/components/new-area/a.tsx','docs/executable.ts'])expect(planImpact([path]).mode).toBe('full');
});
it('a failed shadow lookup reports full fallback without preventing existing validation',()=>{
 const steps=parse(readFileSync('.github/workflows/harness-verify.yml','utf8')).jobs['verify-affected'].steps;
 const step=steps.find((s:any)=>s.name?.startsWith('Report shadow'));
 const dir=mkdtempSync(join(tmpdir(),'ci-shadow-fallback-'));
 try{
  execFileSync('bash',['-c',step.run],{env:{...process.env,CI_SCOPE_BASE_SHA:'0'.repeat(40),GITHUB_SHA:'a'.repeat(40),RUNNER_TEMP:dir,GITHUB_STEP_SUMMARY:join(dir,'summary')}});
  expect(JSON.parse(readFileSync(join(dir,'ci-test-plan.json'),'utf8'))).toMatchObject({mode:'full',shadow:true,error:'SHADOW_PLAN_UNAVAILABLE'});
  expect(steps.find((s:any)=>s.name==='Retain shadow impact plan')['continue-on-error']).toBe(true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
