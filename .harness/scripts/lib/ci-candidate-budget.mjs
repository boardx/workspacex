/** One observer-wide read budget. Metrics are diagnostics, never evidence authority. */
import { performance } from 'node:perf_hooks';

export const OBSERVATION_LIMITS = Object.freeze({ maxRequests: 200, maxElapsedMs: 90_000, requestTimeoutMs: 10_000 });
export class ObservationBudgetError extends Error {
  constructor(reason) { super(reason); this.name = 'ObservationBudgetError'; this.reason = reason; }
}
const requireFact = (value, reason) => { if (!value) throw new ObservationBudgetError(reason); };
const reasonFor = error => typeof error?.reason === 'string' && /^[a-z0-9_:-]{1,120}$/.test(error.reason) ? error.reason : 'observation_read_failed';
const milliseconds = value => Math.max(0, Math.round(value));

/** Names contain no route IDs, query values, repository tokens or signed URLs. */
export function observationRequestFamily(path) {
  if (path === '') return 'repository';
  if (/^\/actions\/workflows\/\d+\/runs(?:\?|$)/.test(path)) return 'workflow-catalog';
  if (/^\/actions\/runs\/\d+\/attempts\/\d+\/jobs/.test(path)) return 'jobs';
  if (/^\/actions\/runs\/\d+\/attempts\/\d+$/.test(path)) return 'exact-attempt';
  if (/^\/actions\/runs\/\d+\/artifacts/.test(path)) return 'artifacts';
  if (/^\/actions\/runs\/\d+$/.test(path)) return 'latest-run';
  if (/^\/actions\/jobs\/\d+\/logs$/.test(path)) return 'job-logs';
  if (/^\/actions\/artifacts\/\d+\/zip$/.test(path)) return 'artifact-zip';
  if (/^\/actions\/workflows\/\d+$/.test(path)) return 'workflow';
  if (/^\/(?:pulls|commits)\//.test(path)) return 'candidate-association';
  if (/^\/git\//.test(path)) return 'git-object';
  return 'other-read';
}

/** Lower limits are test seams; callers cannot lift the shipped hard bounds. */
export function createObservationBudget(options = {}) {
  const limits = { ...OBSERVATION_LIMITS, ...options };
  for (const name of Object.keys(OBSERVATION_LIMITS)) requireFact(Number.isSafeInteger(limits[name]) && limits[name] > 0 && limits[name] <= OBSERVATION_LIMITS[name], 'observer_budget_policy_invalid');
  const clock = options.clock ?? (() => performance.now());
  requireFact(typeof clock === 'function', 'observer_budget_clock_invalid');
  const startedAt = clock();
  requireFact(Number.isFinite(startedAt), 'observer_budget_clock_invalid');
  let requests = 0, stoppedReason = null, phase = 'unclassified', transport = false;
  const families = new Map(), routes = [];
  const elapsed = () => {
    const value = clock() - startedAt;
    requireFact(Number.isFinite(value) && value >= 0, 'observer_budget_clock_invalid');
    return value;
  };
  const stop = reason => { stoppedReason ??= reason; throw new ObservationBudgetError(stoppedReason); };
  const check = () => {
    if (stoppedReason) stop(stoppedReason);
    if (elapsed() >= limits.maxElapsedMs) stop('observer_time_budget_exhausted');
  };
  const budget = {
    markTransport() { transport = true; },
    check,
    async call(family, operation) {
      check();
      requireFact(/^[a-z][a-z0-9-]{0,59}$/.test(family) && typeof operation === 'function', 'observer_budget_operation_invalid');
      if (requests >= limits.maxRequests) stop('observer_request_budget_exhausted');
      requests++;
      const entry = families.get(family) ?? { family, requests: 0, completed: 0, failed: 0, elapsedMs: 0 };
      families.set(family, entry); entry.requests++;
      const requestStart = elapsed(), remaining = limits.maxElapsedMs - requestStart;
      const timeoutMs = Math.min(limits.requestTimeoutMs, remaining);
      const timeoutReason = remaining <= limits.requestTimeoutMs ? 'observer_time_budget_exhausted' : 'observer_request_timeout';
      const controller = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { stoppedReason ??= timeoutReason; controller.abort(); reject(new ObservationBudgetError(stoppedReason)); }, timeoutMs);
      });
      try {
        const value = await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout]);
        check(); entry.completed++; return value;
      } catch (error) {
        entry.failed++;
        // Refused headers/body/HTTP responses must not leave a transport open.
        controller.abort();
        // Ordinary HTTP/validation failures remain the caller's precise fallback.
        // Timeout/request/elapsed exhaustion is irreversible across every suite.
        if (stoppedReason) throw new ObservationBudgetError(stoppedReason);
        throw error;
      } finally { clearTimeout(timer); entry.elapsedMs += milliseconds(elapsed() - requestStart); }
    },
    async measure(name, operation) {
      requireFact(/^[a-z][a-z0-9-]{0,59}$/.test(name) && typeof operation === 'function', 'observer_budget_route_invalid');
      const previous = phase, start = elapsed(), before = requests;
      phase = name;
      const route = { route: name, requests: 0, elapsedMs: 0, outcome: 'completed', reason: null };
      routes.push(route);
      try { check(); const value = await operation(); check(); return value; }
      catch (error) { route.outcome = 'fallback'; route.reason = reasonFor(error); throw error; }
      finally { route.requests = requests - before; route.elapsedMs = milliseconds(elapsed() - start); phase = previous; }
    },
    snapshot() {
      return { schemaVersion: 1, diagnosticsOnly: true, executionAuthorityVerified: false, skip: false, runFull: true,
        limits: { maxRequests: limits.maxRequests, maxElapsedMs: limits.maxElapsedMs, requestTimeoutMs: limits.requestTimeoutMs },
        requests, elapsedMs: milliseconds(elapsed()), exhausted: stoppedReason !== null, reason: stoppedReason,
        countUnit: transport ? 'HTTP attempts including redirects' : 'supplied API invocations',
        activeRoute: phase, requestFamilies: [...families.values()].map(value => ({ ...value })), routes: routes.map(value => ({ ...value })) };
    },
  };
  return budget;
}

/** Supplied APIs (fixtures or other readers) share the same operation-wide bounds. */
export function budgetedObservationApi(api, budget = api?.observationBudget ?? createObservationBudget()) {
  requireFact(typeof api === 'function' && typeof budget?.call === 'function', 'observer_budget_api_invalid');
  if (api.observationBudget === budget) return api;
  requireFact(api.observationBudget === undefined, 'observer_budget_identity_mismatch');
  const wrapped = (path, options = {}) => budget.call(observationRequestFamily(path), signal => api(path, { ...options, signal }));
  Object.defineProperty(wrapped, 'observationBudget', { value: budget });
  return wrapped;
}
