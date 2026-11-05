import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
import {evaluateIf} from './lib/ci-job-conditions.mjs';
const job=parse(readFileSync('.github/workflows/harness-verify.yml','utf8')).jobs['verify-control-plane'];
const expensive=new Set(['Exercise minimal Docker release command offline','Exercise tag schema routing and durable handoff offline','harness 控制平面自测（含门控反证）']);
it('requires a successful exact-source scope producer before control-plane validation',()=>{
 expect(job.needs).toEqual(['doc-smoke-scope']);
 expect(job.if).not.toContain('always()');
});
it('skips only the three unrelated selftest/rehearsal steps for proven UI candidates',()=>{
 const selected=job.steps.filter((s:any)=>expensive.has(s.name));
 expect(selected).toHaveLength(3);
 for(const step of selected)expect(step.if).toBe("needs.doc-smoke-scope.outputs.mode != 'targeted-ui'");
 // Empty/unknown output takes the full path; only the exact proven mode can skip.
 for(const mode of ['',undefined,'full','candidate-ui','unknown','targeted-ui']){
  const probe={eventName:'merge_group',ref:'refs/heads/gh-readonly-queue/develop/pr-1-abc',baseBranch:'develop',regressionMode:mode};
  for(const step of selected)expect(evaluateIf(step.if,probe,{needsResults:new Map([['doc-smoke-scope','success']])})).toBe(mode!=='targeted-ui');
 }
 for(const step of job.steps.filter((s:any)=>!expensive.has(s.name)))expect(step.if??'').not.toContain('doc-smoke-scope.outputs.mode');
 expect(selected.find((s:any)=>s.name.startsWith('harness')).run).toBe('pnpm exec vitest run --dir .harness --bail=1');
});
