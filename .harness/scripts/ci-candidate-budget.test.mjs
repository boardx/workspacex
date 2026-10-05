import assert from 'node:assert/strict';
import { OBSERVATION_LIMITS, ObservationBudgetError, createObservationBudget, budgetedObservationApi, observationRequestFamily } from './lib/ci-candidate-budget.mjs';
import { createGitHubApi } from './lib/ci-candidate-github.mjs';
const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');
const boundary = value => { assert.equal(value.diagnosticsOnly, true); assert.equal(value.executionAuthorityVerified, false); assert.equal(value.skip, false); assert.equal(value.runFull, true); };

test('shipped request and elapsed limits are finite; test seams may only reduce them', () => {
  assert.deepEqual(OBSERVATION_LIMITS, { maxRequests: 200, maxElapsedMs: 90_000, requestTimeoutMs: 10_000 });
  for (const field of Object.keys(OBSERVATION_LIMITS)) {
    for (const invalid of [0, -1, Infinity, NaN, '1', null, 0.5, OBSERVATION_LIMITS[field] + 1]) assert.throws(() => createObservationBudget({ [field]: invalid }), /observer_budget_policy_invalid/);
  }
  boundary(createObservationBudget().snapshot());
});

test('request exhaustion is global across routes and latches without another API invocation', async () => {
  const budget = createObservationBudget({ maxRequests: 2 }); let called = 0;
  const api = budgetedObservationApi(async () => ++called, budget);
  await budget.measure('main-discovery', () => api('/actions/workflows/10/runs?per_page=100&page=1'));
  await budget.measure('candidate-history', () => api('/actions/runs/100'));
  for (const route of ['candidate-history', 'next-suite', 'main-discovery']) await assert.rejects(budget.measure(route, () => api('/pulls/9')), /observer_request_budget_exhausted/);
  assert.equal(called, 2); const stats = budget.snapshot(); boundary(stats);
  assert.equal(stats.requests, 2); assert.equal(stats.exhausted, true); assert.equal(stats.reason, 'observer_request_budget_exhausted');
  assert.deepEqual(stats.routes.map(row => row.requests), [1, 1, 0, 0, 0]);
  assert.equal(stats.routes[2].outcome, 'fallback');
});

test('elapsed budget exhausted before request produces no transport side effect', async () => {
  let now = 10, called = 0; const budget = createObservationBudget({ maxElapsedMs: 20, clock: () => now });
  now += 20;
  await assert.rejects(budget.call('latest-run', async () => ++called), /observer_time_budget_exhausted/);
  assert.equal(called, 0); assert.equal(budget.snapshot().requests, 0); boundary(budget.snapshot());
});

test('a response that arrives after the operation deadline cannot be accepted', async () => {
  let now = 0; const budget = createObservationBudget({ maxElapsedMs: 10, clock: () => now });
  await assert.rejects(budget.call('latest-run', async () => { now = 11; return { status: 'completed', conclusion: 'success' }; }), /observer_time_budget_exhausted/);
  assert.equal(budget.snapshot().requestFamilies[0].completed, 0);
  assert.equal(budget.snapshot().requestFamilies[0].failed, 1); boundary(budget.snapshot());
});

test('an uncooperative hanging request returns bounded fallback and aborts the supplied signal', async () => {
  const budget = createObservationBudget({ requestTimeoutMs: 5, maxElapsedMs: 100 }); let signal;
  await assert.rejects(budget.call('latest-run', value => { signal = value; return new Promise(() => {}); }), /observer_request_timeout/);
  assert.equal(signal.aborted, true); assert.equal(budget.snapshot().exhausted, true);
  await assert.rejects(budget.call('latest-run', () => Promise.resolve('green')), /observer_request_timeout/);
  assert.equal(budget.snapshot().requests, 1);
});

test('the remaining global deadline takes precedence over the individual timeout', async () => {
  const budget = createObservationBudget({ requestTimeoutMs: 20, maxElapsedMs: 5 });
  await assert.rejects(budget.call('latest-run', () => new Promise(() => {})), /observer_time_budget_exhausted/);
  assert.equal(budget.snapshot().reason, 'observer_time_budget_exhausted'); boundary(budget.snapshot());
});

test('successful calls clear timers and return values while ordinary read failures keep precise reasons', async () => {
  const budget = createObservationBudget({ requestTimeoutMs: 20 });
  assert.deepEqual(await budget.call('repository', async () => ({ id: 1 })), { id: 1 });
  const denied = Object.assign(new Error('sensitive arbitrary error'), { reason: 'github_api_http_403' });
  await assert.rejects(budget.measure('bootstrap', () => budget.call('repository', async () => { throw denied; })), error => error === denied);
  assert.equal(budget.snapshot().exhausted, false);
  assert.equal(budget.snapshot().routes[0].reason, 'github_api_http_403');
  assert.equal(budget.snapshot().requestFamilies[0].requests, 2);
});

test('route failures omit exception text and signed URLs; timings have no input credentials', async () => {
  const budget = createObservationBudget();
  await assert.rejects(budget.measure('main-discovery', () => budget.call('other-read', async () => { throw Error('Bearer secret https://storage.example/?signature=private'); })), /Bearer secret/);
  const metrics = JSON.stringify(budget.snapshot());
  assert.equal(metrics.includes('secret'), false); assert.equal(metrics.includes('signature'), false);
  assert.equal(budget.snapshot().routes[0].reason, 'observation_read_failed');
});

test('request family classification records route types without IDs, query values or tokens', () => {
  for (const [path, family] of [['', 'repository'], ['/actions/workflows/10/runs?per_page=100&page=1', 'workflow-catalog'], ['/actions/runs/100', 'latest-run'], ['/actions/runs/100/attempts/2', 'exact-attempt'], ['/actions/runs/100/attempts/2/jobs?x=y', 'jobs'], ['/actions/runs/100/artifacts?x=y', 'artifacts'], ['/actions/jobs/101/logs', 'job-logs'], ['/actions/artifacts/301/zip', 'artifact-zip'], ['/actions/workflows/10', 'workflow'], ['/pulls/9', 'candidate-association'], ['/git/trees/abc?recursive=1', 'git-object'], ['/private?secret=one', 'other-read']]) assert.equal(observationRequestFamily(path), family);
});

test('wrapping an API twice with its same budget counts once; a different budget is rejected', async () => {
  const budget = createObservationBudget(); const api = budgetedObservationApi(async () => 1, budget);
  assert.equal(budgetedObservationApi(api, budget), api); assert.equal(budgetedObservationApi(api), api);
  await api('/actions/runs/1'); assert.equal(budget.snapshot().requests, 1);
  assert.throws(() => budgetedObservationApi(api, createObservationBudget()), /observer_budget_identity_mismatch/);
});

test('snapshots are detached diagnostics and cannot reset the internal budget', async () => {
  const budget = createObservationBudget({ maxRequests: 1 });
  await budget.measure('main-discovery', () => budget.call('workflow-catalog', async () => null));
  const modified = budget.snapshot(); modified.requests = 0; modified.routes[0].requests = 0; modified.requestFamilies[0].requests = 0; modified.limits.maxRequests = 80;
  await assert.rejects(budget.call('repository', async () => null), /observer_request_budget_exhausted/);
  assert.equal(budget.snapshot().requests, 1); assert.equal(budget.snapshot().routes[0].requests, 1); assert.equal(budget.snapshot().requestFamilies[0].requests, 1);
});

test('diagnostic request counters identify supplied APIs versus real HTTP transports', async () => {
  const budget = createObservationBudget(); assert.equal(budget.snapshot().countUnit, 'supplied API invocations');
  budget.markTransport(); await budget.call('log-redirect', async () => 1);
  assert.equal(budget.snapshot().countUnit, 'HTTP attempts including redirects'); boundary(budget.snapshot());
});

test('invalid clocks, route names and APIs fail closed without accepting arbitrary caller code', async () => {
  assert.throws(() => createObservationBudget({ clock: 1 }), /observer_budget_clock_invalid/);
  assert.throws(() => createObservationBudget({ clock: () => Infinity }), /observer_budget_clock_invalid/);
  assert.throws(() => budgetedObservationApi(null), /observer_budget_api_invalid/);
  const budget = createObservationBudget();
  await assert.rejects(budget.call('https://secret', async () => 1), /observer_budget_operation_invalid/);
  await assert.rejects(budget.measure('sensitive?token=one', async () => 1), /observer_budget_route_invalid/);
  assert.equal(budget.snapshot().requests, 0);
  assert.equal(new ObservationBudgetError('observer_time_budget_exhausted').reason, 'observer_time_budget_exhausted');
});

test('real Fetch response reading and JSON parsing use one HTTP attempt and the shared budget', async () => {
  const budget = createObservationBudget();
  const api = createGitHubApi({ repository: 'boardx/workspacex', token: 'test-only', budget, fetchImpl: async () => new Response(JSON.stringify({ total_count: 0, workflow_runs: [] })) });
  assert.equal(budgetedObservationApi(api, budget), api);
  assert.deepEqual(await api('/actions/workflows/10/runs?per_page=100&page=1'), { total_count: 0, workflow_runs: [] });
  assert.equal(budget.snapshot().requests, 1); assert.equal(budget.snapshot().countUnit, 'HTTP attempts including redirects');
});

test('storage redirects consume a second request and receive no Authorization header', async () => {
  const budget = createObservationBudget({ maxRequests: 2 }); const calls = [];
  const api = createGitHubApi({ repository: 'boardx/workspacex', token: 'private-test-value', budget, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://storage.example/one?signature=private-test-value' } }) : new Response('actual log');
  } });
  assert.equal(await api('/actions/jobs/1/logs', { raw: true }), 'actual log');
  assert.equal(calls.length, 2); assert.equal(calls[1].options.headers, undefined);
  assert.equal(budget.snapshot().requests, 2); assert.equal(budget.snapshot().requestFamilies[1].family, 'storage-redirect');
  assert.equal(JSON.stringify(budget.snapshot()).includes('private-test-value'), false);
});

test('a redirect cannot evade the global cap even when the first HTTP request succeeded', async () => {
  const budget = createObservationBudget({ maxRequests: 1 }); let calls = 0;
  const api = createGitHubApi({ repository: 'boardx/workspacex', token: 'test-only', budget, fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://storage.example/one' } }); } });
  await assert.rejects(api('/actions/jobs/1/logs', { raw: true }), /observer_request_budget_exhausted/);
  assert.equal(calls, 1); assert.equal(budget.snapshot().requests, 1); boundary(budget.snapshot());
});

test('hung response bodies are bounded after HTTP headers arrive; abort reaches body transport', async () => {
  const budget = createObservationBudget({ requestTimeoutMs: 5 }); let bodyAborted = false;
  const api = createGitHubApi({ repository: 'boardx/workspacex', token: 'test-only', budget, fetchImpl: async (_url, options) => new Response(new ReadableStream({ start(controller) {
    options.signal.addEventListener('abort', () => { bodyAborted = true; controller.error(new Error('transport aborted')); }, { once: true });
  } })) });
  await assert.rejects(api('/actions/runs/1'), /observer_request_timeout/);
  assert.equal(bodyAborted, true); assert.equal(budget.snapshot().requests, 1); assert.equal(budget.snapshot().exhausted, true);
});

test('hung storage response cannot consume an independent fresh deadline', async () => {
  const budget = createObservationBudget({ maxRequests: 3, maxElapsedMs: 20, requestTimeoutMs: 5 }); let calls = 0, storageSignal;
  const api = createGitHubApi({ repository: 'boardx/workspacex', token: 'test-only', budget, fetchImpl: async (_url, options) => {
    calls++;
    if (calls === 1) return new Response(null, { status: 302, headers: { location: 'https://storage.example/one' } });
    storageSignal = options.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(api('/actions/jobs/1/logs', { raw: true }), /observer_request_timeout/);
  // The first request's timeout propagates immediately to storage transport.
  assert.equal(storageSignal.aborted, true); assert.equal(calls, 2); assert.equal(budget.snapshot().requests, 2);
  await assert.rejects(api('/actions/runs/1'), /observer_request_timeout/); assert.equal(calls, 2);
});

test('oversized declared API bodies are refused within the same request budget', async () => {
  const budget = createObservationBudget(); let signal;
  const api = createGitHubApi({ repository: 'boardx/workspacex', token: 'test-only', budget, fetchImpl: async (_url, options) => { signal = options.signal; return new Response('{}', { headers: { 'content-length': '20000001' } }); } });
  await assert.rejects(api('/actions/runs/1'), /github_response_too_large/);
  assert.equal(budget.snapshot().requests, 1); assert.equal(budget.snapshot().requestFamilies[0].failed, 1);
  assert.equal(signal.aborted, true);
});

test('unsafe redirects are rejected without a second request or URL-bearing diagnostics', async () => {
  for (const location of ['http://storage.example/one', 'https://user:secret@storage.example/one']) {
    const budget = createObservationBudget(); let calls = 0;
    const api = createGitHubApi({ repository: 'boardx/workspacex', token: 'test-only', budget, fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location } }); } });
    await assert.rejects(budget.measure('main-checkout', () => api('/actions/jobs/1/logs', { raw: true })), /unsafe_log_redirect/);
    assert.equal(calls, 1); assert.equal(JSON.stringify(budget.snapshot()).includes('secret'), false);
  }
});
