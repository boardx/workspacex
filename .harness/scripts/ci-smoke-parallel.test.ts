import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { LANES } from './ci-lane-dedup.mjs';
import { failedLanes, FULL_REGRESSION_LANES } from './ci-full-regression.mjs';
import { smokeVerdict } from './ci-smoke-verdict.mjs';
const jobs = parse(readFileSync('.github/workflows/harness-verify.yml', 'utf8')).jobs;
const success = () => Object.fromEntries(FULL_REGRESSION_LANES.map(name => [name, { result: 'success', outputs: { verdict: 'success' } }]));
describe('directory and full-stack smoke execute independently without losing coverage', () => {
  it('creates independent runners and assigns the directory command exactly once', () => {
    expect(jobs['directory-smoke']).toBeDefined();
    expect(jobs['directory-smoke']['timeout-minutes']).toBe(30);
    for (const name of ['fullstack-smoke', 'directory-smoke']) {
      expect(jobs[name].needs).toBe('doc-smoke-scope');
      expect(jobs[name].needs).not.toContain('fullstack-smoke');
      expect(jobs[name].needs).not.toContain('directory-smoke');
      expect(jobs[name].outputs.verdict).toBe('${{ steps.smoke-verdict.outputs.verdict }}');
      expect(jobs[name]['continue-on-error']).toBe(true);
    }
    expect(JSON.stringify(jobs['fullstack-smoke'])).not.toContain('pnpm run verify:digital-directory-cards');
    expect(JSON.stringify(jobs['directory-smoke'])).toContain('ci-fullstack-runtime.mjs directory -- pnpm run verify:digital-directory-cards');
    expect(LANES['directory-smoke'].artifact).not.toBe(LANES['fullstack-smoke'].artifact);
    expect(jobs['e2e-full'].needs).toContain('directory-smoke');
  });
  it('rejects directory failure despite informational job success', () => {
    expect(FULL_REGRESSION_LANES).toContain('directory-smoke');
    expect(failedLanes(success())).toEqual([]);
    for (const verdict of ['failure', 'skipped', 'cancelled', undefined]) {
      expect(failedLanes({ ...success(), 'directory-smoke': { result: 'success', outputs: { verdict } } })).toEqual(['directory-smoke']);
    }
  });
  it('directory verdict requires actual command and artifact success', () => {
    const steps = { directory: { outcome: 'success' }, evidence: { outcome: 'success' } };
    expect(smokeVerdict({ lane: 'directory-smoke', run: 'true', steps })).toBe('success');
    for (const name of Object.keys(steps)) {
      for (const outcome of ['failure', 'skipped', 'cancelled', undefined]) {
        expect(smokeVerdict({ lane: 'directory-smoke', run: 'true', steps: { ...steps, [name]: { outcome } } })).toBe('failure');
      }
    }
    expect(smokeVerdict({ lane: 'unknown', run: 'false', sourceResult: 'success', steps: { dedup: { outcome: 'success' } } })).toBe('failure');
  });
});
