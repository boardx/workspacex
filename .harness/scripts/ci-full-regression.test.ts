import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { failedLanes, FULL_REGRESSION_LANES } from './ci-full-regression.mjs';

const root = resolve(import.meta.dirname, '../..');
const workflow = parse(readFileSync(resolve(root, '.github/workflows/harness-verify.yml'), 'utf8'));
const success = () => Object.fromEntries(FULL_REGRESSION_LANES.map(name => [name, { result: 'success' }]));

describe('full regression preserves all independent lane verdicts', () => {
  it('requires all three original public commands without sharding verify:full', () => {
    const commands = ['TURBO_FORCE=true pnpm run verify:full', 'pnpm run verify:chat-read', 'pnpm run verify:self-service-profile'];
    expect(FULL_REGRESSION_LANES).toHaveLength(commands.length);
    for (const command of commands) {
      const matches = FULL_REGRESSION_LANES.filter(name => workflow.jobs[name].steps.some((s: {run?: string}) => s.run?.includes(command)));
      expect(matches).toHaveLength(1);
    }
    expect(failedLanes(success())).toEqual([]);
  });
  it('keeps a visible journey log on success and preserves piped command failures', () => {
    for (const name of ['chat-read', 'self-service-profile']) {
      const steps = workflow.jobs[name].steps;
      const execute = steps.find((s: { run?: string }) => s.run?.includes(`pnpm run verify:${name}`));
      expect(execute.run).toContain('set -o pipefail');
      expect(execute.run).toContain(`| tee phases/phase-01-run-a-project/evidence/ci/${name}.log`);
      const upload = steps.find((s: { uses?: string }) => s.uses?.startsWith('actions/upload-artifact@'));
      expect(upload.with.path).toContain(`evidence/ci/${name}.log`);
    }
  });
  it.each(['failure', 'cancelled', 'skipped', 'unknown', undefined])('fails closed on %s in every lane', result => {
    for (const name of FULL_REGRESSION_LANES) expect(failedLanes({ ...success(), [name]: { result } })).toEqual([name]);
  });
  it('rejects missing or malformed dependency data', () => {
    expect(failedLanes(null)).toEqual(FULL_REGRESSION_LANES);
    const result = spawnSync(process.execPath, ['.harness/scripts/ci-full-regression.mjs'], {
      cwd: root, env: { ...process.env, CI_LANE_RESULTS: 'invalid' }, encoding: 'utf8',
    });
    expect(result.status).toBe(1);
  });
  it('has independent timeout budgets and a failure-aware stable aggregate', () => {
    const aggregate = workflow.jobs['e2e-full'];
    expect(aggregate.needs).toEqual(FULL_REGRESSION_LANES);
    expect(aggregate.if).toContain('always()');
    for (const name of FULL_REGRESSION_LANES) {
      const job = workflow.jobs[name];
      expect(job.needs).toBeUndefined();
      expect(job['continue-on-error']).toBeUndefined();
      expect(job.if).toContain("github.event_name != 'pull_request'");
      expect(job.if).toContain("github.event_name != 'workflow_dispatch' || inputs.run_e2e_full");
      const measured = job.steps.find((step: Record<string, unknown>) => step['timeout-minutes']);
      expect(measured['timeout-minutes']).toBeLessThan(job['timeout-minutes']);
    }
    expect(aggregate.if).toContain(workflow.jobs[FULL_REGRESSION_LANES[0]].if);
    expect(aggregate.steps.at(-1).env.CI_LANE_RESULTS).toBe('${{ toJSON(needs) }}');
  });
});
