import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { failedLanes, FULL_REGRESSION_LANES } from './ci-full-regression.mjs';

const root = resolve(import.meta.dirname, '../..');
const workflow = parse(readFileSync(resolve(root, '.github/workflows/harness-acceptance.yml'), 'utf8'));
const success = () => Object.fromEntries(FULL_REGRESSION_LANES.map(name => [name,
  ['fullstack-smoke', 'directory-smoke', 'board-smoke'].includes(name) ? { result: 'success', outputs: { verdict: 'success' } } : { result: 'success' },
]));

describe('full regression preserves all independent lane verdicts', () => {
  it('preserves canonical static gates when reusing only control-plane self-tests', () => {
    const command = workflow.jobs['base-control-plane'].steps.map((step:any) => step.run ?? '').join('\n');
    expect(command).toContain('node .harness/scripts/ci-harness-static.mjs');
    expect(command).toContain('node .harness/scripts/ci-queue-ready.mjs --control-plane');
    expect(command).toContain('pnpm run verify:harness:raw');
  });
  it('requires one base producer and one browser producer without repeating verify:full', () => {
    const commands = ['pnpm run verify:digital-directory-cards', 'pnpm run verify:fullstack-product', 'pnpm run verify:fullstack-board', "--filter='!@repo/api' --filter='!web'", 'ci-chat-shards.mjs --record' , 'pnpm run verify:self-service-profile'];
    expect(FULL_REGRESSION_LANES).toHaveLength(commands.length);
    for (const command of commands) {
      const matches = Object.keys(workflow.jobs).filter(name => workflow.jobs[name].steps.some((s: {run?: string}) => s.run?.includes(command)));
      expect(matches).toHaveLength(1);
    }
    const results = { ...success(), 'fullstack-smoke': { result: 'success', outputs: { verdict: 'success' } } };
    expect(failedLanes(results)).toEqual([]);
    expect(failedLanes({ ...results, 'fullstack-smoke': { result: 'success', outputs: { verdict: 'failure' } } })).toEqual(['fullstack-smoke']);
    expect(failedLanes({ ...results, 'fullstack-smoke': { result: 'success' } })).toEqual(['fullstack-smoke']);
    expect(JSON.stringify(workflow.jobs['full-regression-core'])).not.toContain('pnpm run verify:full');
  });
  it('keeps a visible journey log on success and preserves piped command failures', () => {
    for (const name of ['chat-read', 'self-service-profile']) {
      const steps = workflow.jobs[name==='chat-read'?'chat-test-shards':name].steps;
      const execute = steps.find((s: { run?: string }) => s.run?.includes(name==='chat-read'?'ci-chat-shards.mjs --record':`pnpm run verify:${name}`));
      expect(execute.run).toContain('set -o pipefail');
      expect(execute.run).toContain(`| tee phases/phase-01-run-a-project/evidence/ci/${name}.log`);
      const upload = steps.find((s: { uses?: string, with?: {path?:string} }) => s.uses?.startsWith('actions/upload-artifact@') && s.with?.path?.includes(`evidence/ci/${name}.log`));
      expect(upload).toBeDefined();
      expect(upload.if).toContain('always()');
      if(name==='chat-read'){
        const metadata=steps.find((s:any)=>s.uses?.startsWith('actions/upload-artifact@') && s.with?.name?.startsWith('parallel-chat-'));
        expect(metadata.with.path).toBe('${{ runner.temp }}/shard/');
        expect(metadata.if).toBe('always()');
      }
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
    for (const name of FULL_REGRESSION_LANES.filter(name => !['fullstack-smoke', 'directory-smoke', 'board-smoke'].includes(name))) {
      const job = workflow.jobs[name];
      if(name==='full-regression-core')expect(job.needs).toEqual(['base-compile','base-api-plan','base-api-shards','base-api-exclusive','base-package-tests','base-control-plane','web-test-plan','web-test-shards']);
      else if(name==='chat-read')expect(job.needs).toEqual(['chat-test-plan','chat-test-shards']);else expect(job.needs).toBeUndefined();
      expect(job['continue-on-error']).toBeUndefined();
      expect(job.if).toContain("github.event_name != 'pull_request'");
      expect(job.if).toContain("github.event_name != 'workflow_dispatch' || inputs.run_e2e_full");
      const producer=workflow.jobs[name==='full-regression-core'?'base-package-tests':name==='chat-read'?'chat-test-shards':name];
      const measured = producer.steps.find((step: Record<string, unknown>) => step['timeout-minutes']);
      expect(measured['timeout-minutes']).toBeLessThan(producer['timeout-minutes']);
    }
    expect(aggregate.if).toContain("inputs.verification_lane != 'base'");
    expect(aggregate.if).toContain("github.event_name != 'workflow_dispatch' || inputs.run_e2e_full");
    expect(aggregate.steps.at(-1).env.CI_LANE_RESULTS).toBe('${{ toJSON(needs) }}');
  });
});


describe('acceptance workflow topology', () => {
  it('keeps full and optional lanes outside the automatic PR workflow', () => {
    const automatic = parse(readFileSync(resolve(root, '.github/workflows/harness-verify.yml'), 'utf8'));
    expect(automatic.on.workflow_dispatch).toBeUndefined();
    expect(workflow.on.pull_request).toBeUndefined();
    expect(workflow.on.push).toBeUndefined();
    expect(workflow.on.merge_group.branches).toEqual(['develop']);
    for (const id of ['full-regression-core', 'e2e-full', 'base-api-plan', 'base-api-shards', 'base-api-exclusive', 'chat-read', 'self-service-profile', 'chat-path-coverage', 'chat-task-workbench']) {
      expect(automatic.jobs[id]).toBeUndefined();
      expect(workflow.jobs[id]).toBeDefined();
    }
    for (const id of ['verify-full-compile', 'board-smoke', 'directory-smoke', 'fullstack-smoke']) {
      expect(automatic.jobs[id].if).toContain(id==='verify-full-compile'?"github.event_name == 'pull_request' || github.event_name == 'merge_group'":"github.event_name == 'pull_request'");
      expect(workflow.jobs[id==='verify-full-compile'?'base-compile':id]).toBeDefined();
    }
    for (const job of Object.values(workflow.jobs) as {needs?: string | string[]}[]) {
      for (const id of [job.needs ?? []].flat()) expect(workflow.jobs[id]).toBeDefined();
    }
  });
});
