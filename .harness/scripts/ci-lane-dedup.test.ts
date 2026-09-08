import { describe, expect, it } from 'vitest';
import { findReusableLane, LANES } from './ci-lane-dedup.mjs';

const now = Date.parse('2026-09-09T00:00:00Z');
const source = { event: 'workflow_dispatch', id: 10, head_sha: 'abc', workflow_id: 7, created_at: '2026-09-08T23:00:00Z', html_url: 'https://github.com/o/r/actions/runs/10' };
const steps = [...LANES['fullstack-smoke'].execute, LANES['fullstack-smoke'].upload].map(name => ({ name, status: 'completed', conclusion: 'success' }));
function apiFor(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    '/actions/runs/20': { workflow_id: 7 },
    '/actions/workflows/7/runs?head_sha=abc&per_page=100&page=1': { total_count: 1, workflow_runs: [source] },
    '/actions/runs/10/jobs?filter=latest&per_page=100&page=1': { total_count: 1, jobs: [{ name: 'fullstack-smoke', status: 'completed', conclusion: 'success', steps }] },
    '/actions/runs/10/artifacts?per_page=100&page=1': { total_count: 1, artifacts: [{ name: 'phase-01-fullstack-smoke-evidence-10', expired: false }] },
    ...overrides,
  };
  return async (path: string) => { if (!(path in data)) throw new Error(`unexpected ${path}`); return data[path]; };
}
function lookup(api = apiFor()) { return findReusableLane({ api, sha: 'abc', runId: 20, lane: 'fullstack-smoke', now }); }

describe('CI lane reuse preserves verification identity and verdict', () => {
  it('reuses an executed lane with retained artifacts', async () => { expect(await lookup()).toMatchObject({ result: 'success', source: source.html_url }); });
  it.each(['skipped', 'cancelled', null])('never reuses an unexecuted step (%s)', async conclusion => {
    expect(await lookup(apiFor({ '/actions/runs/10/jobs?filter=latest&per_page=100&page=1': { total_count: 1, jobs: [{ name: 'fullstack-smoke', status: 'completed', conclusion: 'success', steps: [{ ...steps[0], conclusion }, steps[1]] }] } }))).toBeNull();
  });
  it('preserves failed execution even when job continue-on-error reports success', async () => {
    expect(await lookup(apiFor({ '/actions/runs/10/jobs?filter=latest&per_page=100&page=1': { total_count: 1, jobs: [{ name: 'fullstack-smoke', status: 'completed', conclusion: 'success', steps: [{ ...steps[0], conclusion: 'failure' }, steps[1]] }] } }))).toMatchObject({ result: 'failure' });
  });
  it.each([{ ...source, head_sha: 'other' }, { ...source, id: 20 }, { ...source, created_at: '2026-09-07T00:00:00Z' }, { ...source, workflow_id: 8 }, { ...source, event: 'pull_request' }])('rejects different identity, own run, or stale evidence', async run => {
    expect(await lookup(apiFor({ '/actions/workflows/7/runs?head_sha=abc&per_page=100&page=1': { total_count: 1, workflow_runs: [run] } }))).toBeNull();
  });
  it('does not confuse scorecard and smoke', async () => {
    expect(await lookup(apiFor({ '/actions/runs/10/jobs?filter=latest&per_page=100&page=1': { total_count: 1, jobs: [{ name: 'chat-task-workbench', status: 'completed', steps }] } }))).toBeNull();
  });
  it('does not reuse expired artifacts', async () => {
    expect(await lookup(apiFor({ '/actions/runs/10/artifacts?per_page=100&page=1': { total_count: 1, artifacts: [{ name: 'phase-01-fullstack-smoke-evidence-10', expired: true }] } }))).toBeNull();
  });
  it('API failure fails closed instead of silently duplicating heavy work', async () => {
    await expect(lookup(async () => { throw new Error('403'); })).rejects.toThrow('403');
  });
  it('unknown lane fails closed', async () => { await expect(findReusableLane({ api: apiFor(), sha: 'abc', runId: 20, lane: 'typo', now })).rejects.toThrow('Unknown lane'); });
});

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

describe('workflow and executable reuse contract', () => {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/harness-verify.yml', import.meta.url), 'utf8'));
  it.each(Object.keys(LANES))('%s guards all heavy work and preserves failed reuse', lane => {
    const job = workflow.jobs[lane];
    expect(job.concurrency['cancel-in-progress']).toBe(false);
    expect(job.concurrency.queue).toBe('max');
    expect(job.concurrency.group).toContain('github.sha');
    expect(job.concurrency.group).toContain(lane);
    expect(job.concurrency.group).toContain('inputs.fresh_run');
    expect(job.concurrency.group).toContain('github.run_attempt > 1');
    const guard = job.steps.findIndex((s: { id?: string }) => s.id === 'dedup');
    expect(guard).toBe(1);
    for (const step of job.steps.slice(guard + 1)) expect(step.if).toContain('steps.dedup.outputs.run');
    for (const name of [...LANES[lane].execute, LANES[lane].upload]) expect(job.steps.filter((s: {name?: string}) => s.name === name)).toHaveLength(1);
    expect(job.steps.at(-1).run).toContain('ci-lane-dedup.mjs verdict');
    expect(job.steps.at(-1).if).toBe("always() && steps.dedup.outputs.run == 'false'");
  });
  it.each(['failure', '', 'unknown'])('reused %s cannot turn green', result => {
    const run = spawnSync(process.execPath, [new URL('./ci-lane-dedup.mjs', import.meta.url).pathname, 'verdict'], { env: { ...process.env, CI_SOURCE_RESULT: result } });
    expect(run.status).toBe(1);
  });
  it('explicit fresh measurement bypasses reuse without requiring an API token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-dedup-'));
    try {
      const output = join(dir, 'output');
      const run = spawnSync(process.execPath, [new URL('./ci-lane-dedup.mjs', import.meta.url).pathname], { env: { ...process.env, GH_TOKEN: '', CI_FRESH_RUN: 'true', GITHUB_OUTPUT: output } });
      expect(run.status).toBe(0);
      expect(readFileSync(output, 'utf8')).toBe('run=true\n');
    } finally { rmSync(dir, { recursive: true }); }
  });
});


it('a newer failed attempt without evidence invalidates an older green producer', async () => {
  const api = apiFor({
    '/actions/workflows/7/runs?head_sha=abc&per_page=100&page=1': { total_count: 2, workflow_runs: [{ ...source, id: 15, created_at: '2026-09-08T23:30:00Z' }, source] },
    '/actions/runs/15/jobs?filter=latest&per_page=100&page=1': { total_count: 1, jobs: [{ name: 'fullstack-smoke', status: 'completed', conclusion: 'failure', steps: [{ ...steps[0], conclusion: 'failure' }, { ...steps[1], conclusion: 'failure' }] }] },
  });
  expect(await lookup(api)).toBeNull();
});

it('a rerun of an older run is newer evidence than a subsequently created run', async () => {
  const api = apiFor({
    '/actions/workflows/7/runs?head_sha=abc&per_page=100&page=1': { total_count: 2, workflow_runs: [{ ...source, id: 5, run_started_at: '2026-09-08T23:30:00Z' }, source] },
    '/actions/runs/5/jobs?filter=latest&per_page=100&page=1': { total_count: 1, jobs: [{ name: 'fullstack-smoke', status: 'completed', conclusion: 'failure', steps: [] }] },
  });
  expect(await lookup(api)).toBeNull();
});


it('repeated references to a failed producer retain its failure without alternating reruns', async () => {
  const api = apiFor({
    '/actions/workflows/7/runs?head_sha=abc&per_page=100&page=1': { total_count: 2, workflow_runs: [{ ...source, id: 15, created_at: '2026-09-08T23:30:00Z' }, source] },
    '/actions/runs/15/jobs?filter=latest&per_page=100&page=1': { total_count: 1, jobs: [{ name: 'fullstack-smoke', status: 'completed', conclusion: 'failure', steps: [{ name: 'Preserve reused verification verdict', conclusion: 'failure' }] }] },
    '/actions/runs/10/jobs?filter=latest&per_page=100&page=1': { total_count: 1, jobs: [{ name: 'fullstack-smoke', status: 'completed', conclusion: 'failure', steps: [{ ...steps[0], conclusion: 'failure' }, steps[1]] }] },
  });
  expect(await lookup(api)).toMatchObject({ source: source.html_url, result: 'failure' });
});
