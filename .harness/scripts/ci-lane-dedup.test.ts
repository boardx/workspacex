import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLookupApi, findReusableLane, LANES, LOOKUP_LIMITS, runLaneDedup } from './ci-lane-dedup.mjs';

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
    expect(await lookup(apiFor({ '/actions/runs/10/jobs?filter=latest&per_page=100&page=1': { total_count: 1, jobs: [{ name: 'fullstack-smoke', status: 'completed', conclusion: 'success', steps: [{ ...steps[0], conclusion }, ...steps.slice(1)] }] } }))).toBeNull();
  });
  it('preserves failed execution even when job continue-on-error reports success', async () => {
    expect(await lookup(apiFor({ '/actions/runs/10/jobs?filter=latest&per_page=100&page=1': { total_count: 1, jobs: [{ name: 'fullstack-smoke', status: 'completed', conclusion: 'success', steps: [{ ...steps[0], conclusion: 'failure' }, ...steps.slice(1)] }] } }))).toMatchObject({ result: 'failure' });
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
  it('producer discovery reports API read errors to its caller', async () => {
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
      const run = spawnSync(process.execPath, [new URL('./ci-lane-dedup.mjs', import.meta.url).pathname], { env: { ...process.env, GH_TOKEN: '', GITHUB_JOB: 'fullstack-smoke', CI_FRESH_RUN: 'true', GITHUB_OUTPUT: output } });
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
    '/actions/runs/10/jobs?filter=latest&per_page=100&page=1': { total_count: 1, jobs: [{ name: 'fullstack-smoke', status: 'completed', conclusion: 'failure', steps: [{ ...steps[0], conclusion: 'failure' }, ...steps.slice(1)] }] },
  });
  expect(await lookup(api)).toMatchObject({ source: source.html_url, result: 'failure' });
});


it.each([0, 17, null])('a cancelled request invalidates evidence only after execution started (runner %i)', async runner_id => {
  const api = apiFor({
    '/actions/workflows/7/runs?head_sha=abc&per_page=100&page=1': { total_count: 2, workflow_runs: [{ ...source, id: 15, created_at: '2026-09-08T23:30:00Z' }, source] },
    '/actions/runs/15/jobs?filter=latest&per_page=100&page=1': { total_count: 1, jobs: [{ name: 'fullstack-smoke', status: 'completed', conclusion: 'cancelled', runner_id, steps: runner_id ? [{ ...steps[0], conclusion: 'cancelled' }] : [] }] },
  });
  const result = await lookup(api);
  if (runner_id !== 0) expect(result).toBeNull();
  else expect(result).toMatchObject({ source: source.html_url, result: 'success' });
});

describe('bounded lookup transport and executable fallback', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const response = (data: unknown) => new Response(JSON.stringify(data));
  function cli(overrides: Record<string, unknown> = {}, data = apiFor()) {
    const files = new Map<string, string>(), logs: string[] = [];
    const env = { GITHUB_JOB: 'fullstack-smoke', GITHUB_EVENT_NAME: 'push', GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'abc', GITHUB_RUN_ID: '20', GH_TOKEN: 'test-private-token', GITHUB_OUTPUT: 'output', GITHUB_STEP_SUMMARY: 'summary' };
    const fetchImpl = vi.fn(async (url: string) => { const value = new URL(url); return response(await data(value.pathname.slice('/repos/o/r'.length) + value.search)); });
    const append = (path: string, text: string) => files.set(path, (files.get(path) ?? '') + text);
    const execute = (extra: Record<string, unknown> = {}) => runLaneDedup({ env: { ...env, ...overrides }, fetchImpl, append, log: (text: string) => logs.push(text), ...extra });
    return { files, logs, fetchImpl, execute };
  }
  const assertFull = (result: { run: boolean; reason?: string }, files: Map<string, string>, reason: string) => {
    expect(result).toEqual({ run: true, reason });
    expect(files.get('output')).toBe(`run=true\nresult=\nreason=${reason}\n`);
    expect(files.get('summary')).toContain('executing the original verification');
    expect(files.get('output')).not.toContain('run=false');
  };

  it('uses one fixed policy and retains a successful producer through the actual executable route', async () => {
    expect(LOOKUP_LIMITS).toEqual({ totalMs: 90_000, requestMs: 10_000, requests: 60, bodyBytes: 2 * 1024 * 1024 });
    expect(Object.isFrozen(LOOKUP_LIMITS)).toBe(true);
    const state = cli();
    expect(await state.execute()).toEqual({ run: false, result: 'success' });
    expect(state.files.get('output')).toBe('run=false\nresult=success\n');
    expect(state.files.get('summary')).toContain(source.html_url);
    expect(state.fetchImpl).toHaveBeenCalledTimes(4);
  });
  it('retains observed failure and the existing verdict cannot turn it green', async () => {
    const data = apiFor({ '/actions/runs/10/jobs?filter=latest&per_page=100&page=1': { total_count: 1, jobs: [{ name: 'fullstack-smoke', status: 'completed', conclusion: 'success', steps: [{ ...steps[0], conclusion: 'failure' }, ...steps.slice(1)] }] } });
    const state = cli({}, data);
    expect(await state.execute()).toEqual({ run: false, result: 'failure' });
    expect(state.files.get('output')).toBe('run=false\nresult=failure\n');
    expect(await runLaneDedup({ args: ['verdict'], env: { CI_SOURCE_RESULT: 'failure' } })).toEqual({ exitCode: 1 });
  });
  it.each([{ GITHUB_EVENT_NAME: 'pull_request' }, { CI_FRESH_RUN: 'true' }, { GITHUB_RUN_ATTEMPT: '2' }])('bypasses the API for an independent measurement (%j)', async bypass => {
    const state = cli({ ...bypass, GH_TOKEN: '', GITHUB_REPOSITORY: '', GITHUB_SHA: '', GITHUB_RUN_ID: '' });
    expect(await state.execute()).toEqual({ run: true });
    expect(state.files.get('output')).toBe('run=true\n'); expect(state.fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['typo', '__proto__', 'constructor', 'toString'])('unknown/inherited lane %s is a hard error before lookup or fallback output', async lane => {
    const state = cli({ GITHUB_JOB: lane, CI_FRESH_RUN: 'true' });
    await expect(state.execute()).rejects.toThrow('Unknown lane');
    expect(state.fetchImpl).not.toHaveBeenCalled(); expect(state.files.size).toBe(0);
    const api = vi.fn(); await expect(findReusableLane({ api, sha: 'abc', runId: 20, lane, now })).rejects.toThrow('Unknown lane'); expect(api).not.toHaveBeenCalled();
  });
  it('missing token runs original verification without an API call', async () => {
    const state = cli({ GH_TOKEN: '' }); assertFull(await state.execute(), state.files, 'lookup_missing_token'); expect(state.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500])('HTTP %i returns a visible sanitized full-execution reason', async status => {
    const state = cli();
    state.fetchImpl.mockImplementation(async () => new Response('private-token-bearing-response', { status }));
    assertFull(await state.execute(), state.files, [401, 403].includes(status) ? 'lookup_forbidden' : status === 429 ? 'lookup_rate_limited' : 'lookup_http_error');
    expect(state.logs.join('')).not.toMatch(/test-private-token|token-bearing-response/);
  });
  it('network exception text never enters fallback output or logs', async () => {
    const state = cli(); state.fetchImpl.mockRejectedValue(new Error('private-token-bearing-url'));
    assertFull(await state.execute(), state.files, 'lookup_read_failed'); expect(state.logs.join('')).not.toContain('private-token');
  });
  it('refuses redirects without issuing a token-bearing second request', async () => {
    const state = cli(); state.fetchImpl.mockImplementation(async () => new Response(null, { status: 302, headers: { location: 'https://signed-storage.example/' } }));
    assertFull(await state.execute(), state.files, 'lookup_redirect_refused'); expect(state.fetchImpl).toHaveBeenCalledTimes(1);
    expect((state.fetchImpl.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: 'manual' });
  });
  it.each(['{', 'null', '[]'])('malformed JSON/response %s executes the original verification', async body => {
    const state = cli(); state.fetchImpl.mockImplementation(async () => new Response(body));
    assertFull(await state.execute(), state.files, body === '{' ? 'lookup_invalid_json' : 'lookup_invalid_response');
  });
  it('invalid UTF-8 cannot parse a producer', async () => {
    const state = cli(); state.fetchImpl.mockImplementation(async () => new Response(new Uint8Array([0xff])));
    assertFull(await state.execute(), state.files, 'lookup_invalid_json');
  });
  it.each(['declared', 'streamed'])('bounds the %s response body before accepting JSON', async kind => {
    const state = cli(); state.fetchImpl.mockImplementation(async () => kind === 'declared'
      ? new Response('{}', { headers: { 'content-length': String(LOOKUP_LIMITS.bodyBytes + 1) } })
      : new Response(new Uint8Array(LOOKUP_LIMITS.bodyBytes + 1)));
    assertFull(await state.execute(), state.files, 'lookup_body_limit');
  });
  it.each([
    [{ total_count: -1, workflow_runs: [] }, 'lookup_invalid_response'],
    [{ total_count: 0, workflow_runs: [source] }, 'lookup_invalid_response'],
    [{ total_count: 1, workflow_runs: [] }, 'lookup_pagination_incomplete'],
    [{ total_count: 2, workflow_runs: [source, source] }, 'lookup_invalid_response'],
  ])('invalid/incomplete pagination cannot reach an older green (%j)', async (data, reason) => {
    const state = cli({}, apiFor({ '/actions/workflows/7/runs?head_sha=abc&per_page=100&page=1': data }));
    assertFull(await state.execute(), state.files, reason as string);
  });
  it('changed pagination and the original ten-page bound fall back rather than truncate', async () => {
    for (const change of [true, false]) {
      const state = cli(); state.fetchImpl.mockImplementation(async url => {
        const value = new URL(url); if (value.pathname.endsWith('/20')) return response({ workflow_id: 7 });
        const page = Number(value.searchParams.get('page'));
        return response({ total_count: change && page > 1 ? 12 : 11, workflow_runs: [{ ...source, id: 100 + page }] });
      });
      assertFull(await state.execute(), state.files, change ? 'lookup_pagination_changed' : 'lookup_pagination_limit');
      expect(state.fetchImpl.mock.calls.length).toBe(change ? 3 : 11);
    }
  });
  it.each(['fetch', 'body'])('a hanging %s is aborted after 10s and late success cannot revive reuse', async kind => {
    vi.useRealTimers(); vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(now);
    const state = cli(); let resolveLate: (value: unknown) => void = () => {}; let signal: AbortSignal;
    const pending = new Promise(resolve => { resolveLate = resolve; }); const cancel = vi.fn(async () => {});
    const fetchImpl = vi.fn(async (_url: string, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return kind === 'fetch' ? pending : { ok: true, status: 200, redirected: false, headers: new Headers(), body: { getReader: () => ({ read: () => pending, cancel }) } };
    });
    const complete = state.execute({ fetchImpl, clock: () => 0 });
    await vi.advanceTimersByTimeAsync(10_000);
    assertFull(await complete, state.files, 'lookup_request_timeout'); expect(signal!.aborted).toBe(true);
    const saved = state.files.get('output');
    resolveLate(kind === 'fetch' ? response({ workflow_id: 7 }) : { done: false, value: new TextEncoder().encode('{"workflow_id":7}') });
    await Promise.resolve(); await Promise.resolve();
    expect(state.files.get('output')).toBe(saved); expect(fetchImpl).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    if (kind === 'body') expect(cancel).toHaveBeenCalledOnce();
  });
  it('JSON parsing and late response guards use the same request deadline', async () => {
    let elapsed = 0; const state = cli(); const parseJSON = JSON.parse;
    vi.spyOn(JSON, 'parse').mockImplementation(text => { const value = parseJSON(text); if (text === '{"workflow_id":7}') elapsed = 10_000; return value; });
    assertFull(await state.execute({ clock: () => elapsed }), state.files, 'lookup_request_timeout');
  });
  it('the shared 90s deadline remains latched even if a later clock/read looks successful', async () => {
    let elapsed = 0; const fetchImpl = vi.fn(async () => { elapsed += 9_000; return response({ workflow_id: 7 }); });
    const api = createLookupApi({ repository: 'o/r', token: 'fake', fetchImpl, clock: () => elapsed });
    for (let count = 0; count < 9; count++) await api('/actions/runs/20');
    await expect(api('/actions/runs/20')).rejects.toThrow('lookup_deadline_exceeded');
    elapsed = 0; await expect(api('/actions/runs/20')).rejects.toThrow('lookup_deadline_exceeded'); expect(fetchImpl).toHaveBeenCalledTimes(10);
  });
  it('all endpoints share 60 requests and no environment setting can lift it to reach an old green', async () => {
    const state = cli({ CI_LOOKUP_MAX_REQUESTS: '100000', CI_LOOKUP_TOTAL_MS: '10000000' });
    const skipped = Array.from({ length: 58 }, (_, index) => ({ ...source, id: 100 + index, created_at: '2026-09-08T23:30:00Z' }));
    state.fetchImpl.mockImplementation(async url => {
      const value = new URL(url);
      if (value.pathname.endsWith('/20')) return response({ workflow_id: 7 });
      if (value.pathname.includes('/workflows/')) return response({ total_count: 59, workflow_runs: [...skipped, source] });
      return response({ total_count: 1, jobs: [{ name: 'fullstack-smoke', conclusion: 'skipped' }] });
    });
    assertFull(await state.execute(), state.files, 'lookup_request_limit'); expect(state.fetchImpl).toHaveBeenCalledTimes(60);
  });
  it('a latched count failure cannot issue a sixty-first request even with immediate good responses', async () => {
    const fetchImpl = vi.fn(async () => response({ workflow_id: 7 }));
    const api = createLookupApi({ repository: 'o/r', token: 'fake', fetchImpl, clock: () => 0 });
    for (let count = 0; count < 60; count++) await api('/actions/runs/20');
    for (let count = 0; count < 2; count++) await expect(api('/actions/runs/20')).rejects.toThrow('lookup_request_limit');
    expect(fetchImpl).toHaveBeenCalledTimes(60);
  });
  it.each(['output', 'summary'])('write failure for %s stays a hard error, outside unavailable fallback', async file => {
    for (const denied of [false, true]) {
      const state = cli(); if (denied) state.fetchImpl.mockImplementation(async () => new Response(null, { status: 403 }));
      await expect(state.execute({ append: (path: string) => { if (path === file) throw new Error('write denied'); } })).rejects.toThrow('write denied');
    }
  });
  it('unknown commands and malformed lookup identity remain hard errors', async () => {
    const state = cli({ GITHUB_SHA: '' }); await expect(state.execute()).rejects.toThrow('Invalid lookup identity');
    expect(state.fetchImpl).not.toHaveBeenCalled(); expect(state.files.size).toBe(0);
    await expect(runLaneDedup({ args: ['unsupported'] })).rejects.toThrow('Unknown dedup command');
  });
});
