import { describe, expect, it } from 'vitest';
import { docSmokeScope } from './ci-doc-smoke-scope.mjs';
describe('narrow documentation PR experiment',()=>{
 const context={event:'pull_request',baseBranch:'develop'};
 it('omits unrelated smoke only for nonempty allowlisted markdown changes',()=>{
  expect(docSmokeScope({...context,paths:['docs/design/proposal.md','docs/superpowers/plans/plan.md']})).toBe(false);
 });
 it('retains full coverage for shared inputs, unknown paths and incomplete diffs',()=>{
  for(const paths of [null,[],['pnpm-lock.yaml'],['apps/web/app/page.tsx'],['docs/design/a.md','apps/api/package.json'],['docs/evidence/a.md'],['docs/design/../runtime.md'],['docs/design/a.png']])expect(docSmokeScope({...context,paths})).toBe(true);
 });
 it('never narrows release, merge queue, manual or non-develop PRs',()=>{
  for(const event of ['push','merge_group','workflow_dispatch','schedule'])expect(docSmokeScope({...context,event,paths:['docs/design/a.md']})).toBe(true);
  expect(docSmokeScope({...context,baseBranch:'main',paths:['docs/design/a.md']})).toBe(true);
 });
});
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {inspectDocScope} from './ci-doc-smoke-scope.mjs';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {evaluateIf} from './lib/ci-job-conditions.mjs';
it('uses actual Git diffs and retains coverage on code renamed into docs and symlinks',()=>{
 const root=mkdtempSync(join(tmpdir(),'doc-scope-'));
 const git=(args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
 try {
  git(['init','-q']);git(['config','user.email','fixture@example.invalid']);git(['config','user.name','Fixture']);
  mkdirSync(join(root,'docs/design'),{recursive:true});writeFileSync(join(root,'docs/design/a.md'),'a');writeFileSync(join(root,'runtime.js'),'runtime');git(['add','.']);git(['commit','-qm','base']);
  const base=git(['rev-parse','HEAD']).trim();
  writeFileSync(join(root,'docs/design/a.md'),'changed');git(['add','.']);git(['commit','-qm','docs']);
  const context={event:'pull_request',baseBranch:'develop',base,git};
  expect(inspectDocScope(context)).toBe(false);
  renameSync(join(root,'runtime.js'),join(root,'docs/design/moved.md'));git(['add','-A']);git(['commit','-qm','rename']);expect(inspectDocScope(context)).toBe(true);
  const next=git(['rev-parse','HEAD']).trim();symlinkSync('../../runtime',join(root,'docs/design/link.md'));git(['add','.']);git(['commit','-qm','link']);expect(inspectDocScope({...context,base:next})).toBe(true);
  expect(inspectDocScope({...context,git:()=>{throw Error('unavailable');}})).toBe(true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('skips only the three broad PR lanes; release and unknown output always retain them',()=>{
 const jobs=parse(readFileSync('.github/workflows/harness-verify.yml','utf8')).jobs;
 const acceptance=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8')).jobs;
 for(const name of ['fullstack-smoke','board-smoke','directory-smoke']){
  expect(jobs[name].needs).toBe('doc-smoke-scope');
  for(const eventName of ['pull_request','push','merge_group'])for(const output of ['false','true','']){
   const selected=eventName==='push'?acceptance[name]:jobs[name];
   const expression=selected.if.replaceAll('needs.doc-smoke-scope.outputs.full',`'${output}'`).replaceAll('inputs.verification_lane',"'all'");
   expect(evaluateIf(expression,{id:eventName,eventName,ref:'refs/heads/develop',baseBranch:'develop',label:eventName})).toBe(eventName!=='pull_request'||output!=='false');
  }
 }
 for(const name of ['verify-control-plane','verify-affected','verify-full-compile','organization-create','merge-gate','full-regression-core','e2e-full'])expect(JSON.stringify(jobs[name]??acceptance[name])).not.toContain('doc-smoke-scope');
});
it('keeps the classification parent reachable for post-merge full coverage auditing',()=>{
 const jobs=parse(readFileSync('.github/workflows/harness-verify.yml','utf8')).jobs;
 for(const eventName of ['pull_request','push','merge_group','schedule']){
  const expression=jobs['doc-smoke-scope'].if.replaceAll('inputs.verification_lane',"'all'");
  expect(evaluateIf(expression,{id:eventName,eventName,ref:'refs/heads/develop',baseBranch:'develop',label:eventName})).toBe(true);
 }
});
