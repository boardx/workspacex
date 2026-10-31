import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { evaluateIf } from './lib/ci-job-conditions.mjs';

const harness = parse(readFileSync('.github/workflows/harness-verify.yml', 'utf8'));
const acceptance = parse(readFileSync('.github/workflows/harness-acceptance.yml', 'utf8'));
const backend = parse(readFileSync('.github/workflows/backend-gates.yml', 'utf8'));
const commands = (job: any) => job.steps.map((step: any) => step.run ?? '').join('\n');
const probe = (eventName: string) => ({ id: eventName, eventName, ref: 'refs/heads/develop', baseBranch: 'develop', label: eventName });

describe('static validation has one PR producer, retaining standalone deployment validation', () => {
  it('retains full build followed by full typecheck/lint in the required compile gate', () => {
    const runs = harness.jobs['verify-full-compile'].steps.map((step: any) => step.run).filter(Boolean);
    expect(runs).toContain('pnpm turbo run build');
    expect(runs).toContain('pnpm turbo run typecheck lint --continue');
    expect(runs.indexOf('pnpm turbo run build')).toBeLessThan(runs.indexOf('pnpm turbo run typecheck lint --continue'));
    for (const event of ['pull_request', 'merge_group']) {
      expect(evaluateIf(harness.jobs['verify-full-compile'].if, probe(event))).toBe(true);
    }
    expect(evaluateIf(harness.jobs['verify-full-compile'].if, probe('push'))).toBe(false);
    const base=acceptance.jobs['base-compile'];
    expect(base.if).toBeUndefined();
    const manual=base.steps.filter((step:any)=>step.run?.startsWith('pnpm turbo run'));
    expect(manual.map((step:any)=>step.run)).toEqual(['pnpm turbo run build','pnpm turbo run typecheck lint --continue']);
    for(const step of manual){
      expect(evaluateIf(step.if,probe('merge_group'))).toBe(false);
      expect(evaluateIf(step.if,probe('workflow_dispatch'))).toBe(true);
    }
    const admission=base.steps.find((step:any)=>step.run?.includes('ci-queue-ready.mjs --compile'));
    expect(admission).toBeDefined();
    expect(evaluateIf(admission.if,probe('merge_group'))).toBe(true);
    expect(evaluateIf(admission.if,probe('workflow_dispatch'))).toBe(false);
    expect(base.steps.filter((step:any)=>!step.run?.includes('ci-queue-ready.mjs --compile')).map(({if:condition,...step}:any)=>step)).toEqual(harness.jobs['verify-full-compile'].steps);

  });
  it('affected validation owns tests without running static tasks a second time', () => {
    expect(commands(harness.jobs['verify-affected'])).not.toMatch(/turbo run typecheck lint/);
    expect(commands(harness.jobs['verify-affected'])).toContain('node .github/scripts/run-affected-tests.mjs');
  });
  it('backend keeps its standalone static validation on deployment events, but delegates PR static work', () => {
    const step = backend.jobs['gates-fast'].steps.find((step: any) => step.run === 'pnpm turbo run typecheck lint --filter=@repo/api');
    expect(step).toBeDefined();
    for (const event of ['pull_request','merge_group','push']) expect(evaluateIf(step.if ?? '', probe(event))).toBe(false);
    expect(evaluateIf(step.if ?? '', probe('workflow_dispatch'))).toBe(true);
  });
});
