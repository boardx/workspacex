/** Same immutable commit, workflow, hosted environment and lane; retain the original verdict. */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const LANES = {
  'fullstack-smoke': {
    execute: ['Execute trusted full-stack smoke', 'Execute trace disclosure geometry'],
    upload: 'Upload runtime evidence (success or failure)',
    artifact: 'phase-01-fullstack-smoke-evidence-',
  },
  'full-regression-core': {
    fullRegression: true,
    execute: ['Execute uncached trusted full gate'],
    upload: 'Upload E2E evidence (success or failure)',
    artifact: 'phase-01-e2e-full-evidence-',
  },
  'chat-read': {
    fullRegression: true,
    execute: ['Execute Chat read/write journey (own isolation scope)'],
    upload: 'Upload chat-read evidence (success or failure)',
    artifact: 'phase-01-chat-read-evidence-',
  },
  'self-service-profile': {
    fullRegression: true,
    execute: ['Execute self-service profile journey (own isolation scope)'],
    upload: 'Upload self-service-profile evidence (success or failure)',
    artifact: 'phase-01-self-service-profile-evidence-',
  },
  'chat-path-coverage': {
    execute: ['Execute chat path coverage lane (own isolation scope)'],
    upload: 'Upload chat-path-coverage evidence (success or failure)',
    artifact: 'phase-01-chat-path-coverage-evidence-',
  },
  'chat-task-workbench': {
    execute: ['Execute Chat task workbench scorecard (own isolation scope)'],
    upload: 'Upload chat-task-workbench evidence (success or failure)',
    artifact: 'phase-01-chat-task-workbench-evidence-',
  },
};

export const LOOKUP_LIMITS = Object.freeze({ totalMs: 90_000, requestMs: 10_000, requests: 60, bodyBytes: 2 * 1024 * 1024 });
class LookupUnavailable extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
const unavailable = reason => { throw new LookupUnavailable(reason); };
function laneSpec(lane) {
  if (!Object.hasOwn(LANES, lane)) throw new Error('Unknown lane');
  return LANES[lane];
}

/** Fixed lookup limits; test injection cannot change the production policy. */
export function createLookupApi({ repository, token, fetchImpl = fetch, clock = () => performance.now() }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || typeof token !== 'string' || !token || typeof fetchImpl !== 'function' || typeof clock !== 'function') throw new Error('Invalid lookup configuration');
  const deadline = clock() + LOOKUP_LIMITS.totalMs;
  let requests = 0, failure;
  const latch = reason => new LookupUnavailable(failure ??= reason);
  const assertBudget = () => {
    if (failure) throw latch(failure);
    if (clock() >= deadline) throw latch('lookup_deadline_exceeded');
  };
  const api = async path => {
    assertBudget();
    if (typeof path !== 'string' || !path.startsWith('/actions/') || /[\r\n]/.test(path)) throw new Error('Invalid lookup path');
    if (requests >= LOOKUP_LIMITS.requests) throw latch('lookup_request_limit');
    requests++;
    const controller = new AbortController();
    const requestDeadline = Math.min(deadline, clock() + LOOKUP_LIMITS.requestMs);
    const guard = () => { assertBudget(); if (clock() >= requestDeadline) throw latch('lookup_request_timeout'); };
    let timer, reader;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = latch(requestDeadline === deadline ? 'lookup_deadline_exceeded' : 'lookup_request_timeout');
        controller.abort(); reject(error);
      }, Math.max(0, requestDeadline - clock()));
    });
    try {
      const value = await Promise.race([timeout, (async () => {
        const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
          signal: controller.signal, redirect: 'manual',
        });
        guard();
        if (response.redirected || (response.status >= 300 && response.status < 400)) throw latch('lookup_redirect_refused');
        if (!response.ok) throw latch([401, 403].includes(response.status) ? 'lookup_forbidden' : response.status === 429 ? 'lookup_rate_limited' : 'lookup_http_error');
        const declared = response.headers.get('content-length');
        if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > LOOKUP_LIMITS.bodyBytes)) throw latch('lookup_body_limit');
        if (!response.body) throw latch('lookup_invalid_response');
        reader = response.body.getReader();
        const chunks = []; let size = 0;
        for (;;) {
          const chunk = await reader.read(); guard();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > LOOKUP_LIMITS.bodyBytes) throw latch('lookup_body_limit');
          chunks.push(Buffer.from(chunk.value));
        }
        guard();
        let data;
        try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { throw latch('lookup_invalid_json'); }
        guard(); return data;
      })()]);
      guard(); return value;
    } catch (error) {
      controller.abort();
      throw error instanceof LookupUnavailable ? error : latch('lookup_read_failed');
    } finally {
      clearTimeout(timer);
      if (controller.signal.aborted && reader) {
        try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
      }
    }
  };
  api.assertBudget = assertBudget;
  return api;
}

async function pages(api, path, key) {
  const result = [];
  let total;
  for (let page = 1; page <= 10; page++) {
    const data = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(data?.[key]) || !Number.isSafeInteger(data.total_count) || data.total_count < 0 || data[key].length > 100 || data[key].some(row => !row || typeof row !== 'object' || Array.isArray(row))) unavailable('lookup_invalid_response');
    if (total !== undefined && total !== data.total_count) unavailable('lookup_pagination_changed');
    total = data.total_count;
    result.push(...data[key]);
    const ids = result.map(row => row.id).filter(id => id !== undefined);
    if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) unavailable('lookup_invalid_response');
    if (result.length > total) unavailable('lookup_invalid_response');
    if (result.length === total) return result;
    if (data[key].length === 0) unavailable('lookup_pagination_incomplete');
  }
  unavailable('lookup_pagination_limit');
}

export async function findReusableLane({ api, sha, runId, lane, now = Date.now() }) {
  const spec = laneSpec(lane);
  if (typeof api !== 'function' || typeof sha !== 'string' || !/^[a-f0-9]+$/.test(sha) || sha.length > 128 || !Number.isSafeInteger(runId) || runId <= 0 || !Number.isFinite(now)) throw new Error('Invalid lookup identity');
  const own = await api(`/actions/runs/${runId}`);
  if (!Number.isSafeInteger(own?.workflow_id) || own.workflow_id <= 0) unavailable('lookup_invalid_response');
  const runs = await pages(api, `/actions/workflows/${own.workflow_id}/runs?head_sha=${encodeURIComponent(sha)}`, 'workflow_runs');
  const started = run => Date.parse(run.run_started_at ?? run.created_at);
  for (const run of runs.sort((a, b) => started(b) - started(a))) {
    const age = now - started(run);
    // PR head_sha identifies the source branch, while checkout tests its synthetic merge.
    if (!['push', 'workflow_dispatch'].includes(run.event)) continue;
    if (run.id === Number(runId) || run.head_sha !== sha || run.workflow_id !== own.workflow_id || !(age >= 0 && age < 86_400_000)) continue;
    const jobs = await pages(api, `/actions/runs/${run.id}/jobs?filter=latest`, 'jobs');
    const job = jobs.find(j => j.name === lane);
    if (!job || job.conclusion === 'skipped') continue;
    // A pending request canceled before receiving a runner did not make a new measurement.
    if (job.conclusion === 'cancelled' && job.runner_id === 0 && Array.isArray(job.steps) && job.steps.length === 0) continue;
    if (job.status !== 'completed' || !['success', 'failure'].includes(job.conclusion)) return null;
    // A reused verdict points back to an actual producer. A new failed attempt invalidates old success.
    if (job.steps?.some(s => s.name === 'Preserve reused verification verdict' && ['success', 'failure'].includes(s.conclusion))) continue;
    const executed = spec.execute.map(name => job.steps?.find(s => s.name === name));
    if (!executed.every(s => s?.status === 'completed' && ['success', 'failure'].includes(s.conclusion))) return null;
    if (!job.steps?.some(s => s.name === spec.upload && s.conclusion === 'success')) return null;
    const artifacts = await pages(api, `/actions/runs/${run.id}/artifacts`, 'artifacts');
    if (!artifacts.some(a => a.name === `${spec.artifact}${run.id}` && a.expired === false)) return null;
    if (typeof run.html_url !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/[1-9]\d*$/.test(run.html_url)) unavailable('lookup_invalid_response');
    return { source: run.html_url, result: executed.some(s => s.conclusion === 'failure') || job.conclusion === 'failure' ? 'failure' : 'success' };
  }
  return null;
}

export async function runLaneDedup({ env = process.env, args = [], fetchImpl = fetch, clock = () => performance.now(), append = appendFileSync, log = console.log } = {}) {
  if (!Array.isArray(args) || args.length > 1 || (args.length && args[0] !== 'verdict')) throw new Error('Unknown dedup command');
  if (args[0] === 'verdict') {
    // No shell interpolation of API content; invalid/missing conclusions fail closed.
    return { exitCode: env.CI_SOURCE_RESULT === 'success' ? 0 : 1 };
  }
  laneSpec(env.GITHUB_JOB);
  if (typeof env.GITHUB_OUTPUT !== 'string' || !env.GITHUB_OUTPUT || typeof append !== 'function' || typeof log !== 'function' || typeof fetchImpl !== 'function' || typeof clock !== 'function') throw new Error('Invalid dedup configuration');
  const write = values => append(env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
  if (env.GITHUB_EVENT_NAME === 'pull_request' || env.CI_FRESH_RUN === 'true' || Number(env.GITHUB_RUN_ATTEMPT) > 1) {
    write({ run: 'true' });
    return { run: true };
  }
  const repo = env.GITHUB_REPOSITORY, runId = Number(env.GITHUB_RUN_ID);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !/^[a-f0-9]{1,128}$/.test(env.GITHUB_SHA ?? '') || !Number.isSafeInteger(runId) || runId <= 0) throw new Error('Invalid lookup identity');
  let reuse, reason;
  // Catch only lookup unavailability; configuration and output/summary failures
  // remain hard errors. Never echo token-bearing fetch/body exception text.
  try {
    if (!env.GH_TOKEN) unavailable('lookup_missing_token');
    const api = createLookupApi({ repository: repo, token: env.GH_TOKEN, fetchImpl, clock });
    reuse = await findReusableLane({ api, sha: env.GITHUB_SHA, runId, lane: env.GITHUB_JOB });
    api.assertBudget();
  } catch (error) { reason = error instanceof LookupUnavailable ? error.reason : 'lookup_read_failed'; }
  if (reason) {
    write({ run: 'true', result: '', reason });
    if (env.GITHUB_STEP_SUMMARY) append(env.GITHUB_STEP_SUMMARY, `### Verification lookup unavailable\n\n${reason}; executing the original verification.\n`);
    log(`Verification lookup unavailable: ${reason}; executing the original verification.`);
    return { run: true, reason };
  }
  write({ run: reuse ? 'false' : 'true', result: reuse?.result ?? '' });
  if (reuse) {
    append(env.GITHUB_STEP_SUMMARY, `### Verification reused\n\nSame commit and lane; retained evidence: [source run](${reuse.source}). Original result: **${reuse.result}**.\n\nUse fresh_run or Re-run jobs for an independent new measurement.\n`);
    log(`Reusing ${reuse.source}: ${reuse.result}`);
  }
  return { run: !reuse, result: reuse?.result ?? '' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runLaneDedup({ args: process.argv.slice(2) }).then(result => { process.exitCode = result.exitCode ?? 0; }).catch(error => { console.error(error.message); process.exitCode = 1; });
