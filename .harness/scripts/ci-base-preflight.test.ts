import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
const steps = parse(readFileSync('.github/workflows/harness-verify.yml','utf8')).jobs['full-regression-core'].steps;
describe('base admission fails before expensive runtime preparation',()=>{
 it('retains the full gate but checks license admission before browsers and Python',()=>{
  const index=steps.findIndex((step:any)=>step.name==='Preflight dependency license admission');
  expect(index).toBeGreaterThan(steps.findIndex((step:any)=>step.run==='pnpm install --frozen-lockfile'));
  expect(index).toBeLessThan(steps.findIndex((step:any)=>step.run?.includes('playwright install')));
  expect(index).toBeLessThan(steps.findIndex((step:any)=>step.uses?.startsWith('astral-sh/setup-uv')));
  expect(steps.some((step:any)=>step.run?.includes('TURBO_FORCE=true pnpm run verify:ci-base'))).toBe(true);
 });
 it('preserves actual failed admission despite tee success and retains the diagnostic log',()=>{
  const step=steps.find((step:any)=>step.name==='Preflight dependency license admission');
  expect(step).toBeDefined();
  expect(step.run).toContain('set -o pipefail');
  expect(step.if).toBe("steps.dedup.outputs.run == 'true'");
  const dir=mkdtempSync(join(tmpdir(),'ci-base-admission-'));
  try{
   const script=step.run.replace('pnpm run lint:third-party-license',"bash -c 'echo rejected-license; exit 17'");
   const result=spawnSync('bash',['-ec',script],{cwd:dir,encoding:'utf8'});
   expect(result.status).toBe(17);
   expect(readFileSync(join(dir,'phases/phase-01-run-a-project/evidence/ci/base-preflight.log'),'utf8')).toContain('rejected-license');
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
});
