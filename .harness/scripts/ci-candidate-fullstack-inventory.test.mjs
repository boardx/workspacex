import assert from 'node:assert/strict';
import {
  compareFullstackLegacyLog, fullstackDataFingerprint, fullstackLedgerContextDigest,
  fullstackScopeObservation, fullstackTestId, normalizeFullstackDiscovery, validateFullstackTerminalLedger,
} from './lib/ci-candidate-fullstack-inventory.mjs';

const { describe, it } = process.env.VITEST ? await import('vitest') : await import('node:test');
const copy = value => JSON.parse(JSON.stringify(value));
const context = { repository: 'boardx/workspacex', runId: 37341471501, jobId: 111869810709, runAttempt: 1, sessionId: 'synthetic-comparison-0001' };
function binding(scope) { return { sourceSha: scope.observation.sourceSha, sourceTree: scope.observation.sourceTree, inputFingerprints: copy(scope.observedInputFingerprints) }; }
function reportFor(scope) {
  const files = new Map();
  for (const row of scope.tests) {
    const file = row.file.replace('apps/web/e2e/', '');
    if (!files.has(file)) files.set(file, { title: file, file, specs: [], suites: [] });
    let suite = files.get(file);
    for (const title of row.titlePath.slice(0, -1)) {
      let child = suite.suites.find(value => value.title === title);
      if (!child) { child = { title, file, specs: [], suites: [] }; suite.suites.push(child); }
      suite = child;
    }
    suite.specs.push({ title: row.titlePath.at(-1), file, line: row.line, column: row.column, id: row.frameworkId, ok: true, tags: [], tests: [{ projectId: row.project, projectName: row.project, expectedStatus: row.expectedStatus, annotations: copy(row.annotations), results: [], status: 'skipped' }] });
  }
  return { config: { argv: ['fixed-node', 'fixed-playwright-cli', 'test', '--config', scope.selection.config, ...(scope.scopeId === 'fullstack-smoke' ? [`--project=${scope.selection.project}`] : []), '--list', '--reporter=json'], version: scope.playwrightVersion, shard: null, projects: Object.keys(scope.projectDag).map(name => ({ name, repeatEach: 1 })) }, suites: [...files.values()], errors: [], stats: { expected: 0, skipped: scope.tests.length, unexpected: 0, flaky: 0 } };
}
function rows(report) {
  const result = [];
  const walk = suite => { for (const spec of suite.specs ?? []) for (const test of spec.tests) result.push({ suite, spec, test }); for (const child of suite.suites ?? []) walk(child); };
  report.suites.forEach(walk); return result;
}
function fixture(scopeId = 'fullstack-smoke') {
  const scope = fullstackScopeObservation(scopeId), report = reportFor(scope);
  const normalized = normalizeFullstackDiscovery({ scopeId, report, binding: binding(scope) }); assert.equal(normalized.comparisonComplete, true);
  return { scope, report, definition: normalized.definition };
}
function counts(tests) { return { total: tests.length, passed: tests.filter(test => test.expectedStatus === 'passed').length, skipped: tests.filter(test => test.expectedStatus === 'skipped').length, failed: 0, flaky: 0, retries: 0 }; }
/** A complete SYNTHETIC protocol fixture; this does not run any browser assertion. */
function ledgerFor(definition) {
  const digest = fullstackLedgerContextDigest({ scopeId: definition.scopeId, definitionDigest: definition.definitionDigest, runContext: context });
  const ledger = { schemaVersion: 1, kind: 'fullstack-terminal-ledger-metadata', mode: 'execution-metadata', provenance: 'synthetic', scopeId: definition.scopeId, definitionDigest: definition.definitionDigest, runContext: copy(context), events: [] };
  const emit = (type, fields) => ledger.events.push({ seq: ledger.events.length + 1, contextDigest: digest, type, ...fields });
  emit('suite-begin', { scopeId: definition.scopeId, definitionDigest: definition.definitionDigest, mode: 'execution-metadata', totalTests: definition.tests.length, projects: Object.keys(definition.projectDag) });
  emit('worker-start', { workerId: 'synthetic-worker-1' });
  emit('hook-begin', { hookId: 'synthetic-global-setup', project: null, workerId: null, testId: null, hookKind: 'globalSetup' });
  emit('hook-end', { hookId: 'synthetic-global-setup', status: 'passed', errors: [] });
  const done = new Set();
  while (done.size !== Object.keys(definition.projectDag).length) {
    const project = Object.keys(definition.projectDag).find(name => !done.has(name) && definition.projectDag[name].every(dependency => done.has(dependency))); assert.ok(project);
    emit('project-begin', { project }); const tests = definition.tests.filter(test => test.project === project);
    for (const test of tests) {
      emit('test-begin', { testId: test.id, workerId: 'synthetic-worker-1', attempt: 0 });
      emit('hook-begin', { hookId: `synthetic-before-${test.id}`, project, workerId: 'synthetic-worker-1', testId: test.id, hookKind: 'beforeEach' });
      emit('hook-end', { hookId: `synthetic-before-${test.id}`, status: 'passed', errors: [] });
      emit('test-end', { testId: test.id, workerId: 'synthetic-worker-1', attempt: 0, status: test.expectedStatus, annotations: copy(test.annotations), errors: [] });
    }
    emit('project-end', { project, status: 'completed', counts: counts(tests) }); done.add(project);
  }
  emit('worker-end', { workerId: 'synthetic-worker-1', status: 'completed', errors: [] });
  emit('hook-begin', { hookId: 'synthetic-global-teardown', project: null, workerId: null, testId: null, hookKind: 'globalTeardown' });
  emit('hook-end', { hookId: 'synthetic-global-teardown', status: 'passed', errors: [] });
  emit('suite-end', { status: 'passed', counts: counts(definition.tests), projects: Object.keys(definition.projectDag), errors: [] });
  emit('process-terminal', { exitCode: 0, signal: null, cancelled: false, timedOut: false, oomKilled: false });
  emit('output-drained', { streams: ['stdout', 'stderr', 'ledger'] });
  return ledger;
}
function checkBoundary(result) {
  assert.equal(result.executionAuthorityVerified, false); assert.equal(result.sourceBindingAuthorityVerified, false);
  for (const key of ['apiVerified', 'protectedVerified', 'scopedVerified', 'reuseEligible', 'skip']) assert.equal(result[key], false);
  assert.equal(result.runFull, true); assert.equal(result.metadataOnly, true);
}
function reject(result, reason) { checkBoundary(result); assert.equal(result.comparisonComplete, false); if (reason) assert.ok(result.reasons.includes(reason), `${reason}: ${result.reasons}`); }
const validate = (definition, ledger, expectedRunContext = context) => validateFullstackTerminalLedger({ definition, ledger, expectedRunContext });
const event = (ledger, type) => ledger.events.find(value => value.type === type);
const renumber = ledger => ledger.events.forEach((value, index) => { value.seq = index + 1; });

describe('actual discovery observations remain data, never execution authority', () => {
  it('binds the actual 149/53/7 observation and the single preserved inbox fixme', () => {
    const { scope, definition } = fixture();
    assert.deepEqual(scope.expectedCounts, { tests: 149, files: 53, projects: 7, passed: 148, skipped: 1 });
    assert.equal(fullstackDataFingerprint(scope.tests), 'sha256:8793c82c79f5a5ee5cdfd96137a172482dabf16d75ff6fb4198f18d0fb22dee0');
    const skip = definition.tests.filter(test => test.expectedStatus === 'skipped'); assert.equal(skip.length, 1);
    assert.equal(skip[0].id, 'sha256:6f6b8e02c3bf4d184ad41ba899300bbef9e002e4a39eb58bbc901207158fbf1c');
    assert.equal(skip[0].file, 'apps/web/e2e/inbox-smoke.spec.ts'); assert.equal(skip[0].line, 67);
    assert.deepEqual(skip[0].annotations, [{ type: 'fixme' }]); checkBoundary(definition);
  });
  it('binds the actual geometry 7/5/1 observation with parameterized IDs', () => {
    const { scope, definition } = fixture('trace-geometry');
    assert.deepEqual(scope.expectedCounts, { tests: 7, files: 5, projects: 1, passed: 7, skipped: 0 });
    assert.equal(fullstackDataFingerprint(scope.tests), 'sha256:2c31306f09eed2419ff60f3ced467f376f4ad0fb291fb6ed068851118a59bbd3');
    const parameterized = definition.tests.filter(test => test.file.endsWith('chat-rail-notifications-geometry.spec.ts'));
    assert.equal(parameterized.length, 2); assert.equal(parameterized[0].line, parameterized[1].line); assert.notEqual(parameterized[0].id, parameterized[1].id); checkBoundary(definition);
  });
  it('returns detached observations so callers cannot mutate the shared policy', () => {
    const first = fullstackScopeObservation('fullstack-smoke'); first.tests.length = 0; first.projectDag.seeded.push('fake');
    assert.equal(fullstackScopeObservation('fullstack-smoke').tests.length, 149); assert.deepEqual(fullstackScopeObservation('fullstack-smoke').projectDag.seeded, []);
  });
  it('binds supplied source/tree/input fingerprints but does not authenticate them', () => {
    const { scope, report } = fixture(); const supplied = binding(scope); supplied.sourceSha = 'a'.repeat(40); supplied.sourceTree = 'b'.repeat(40);
    const result = normalizeFullstackDiscovery({ scopeId: scope.scopeId, report, binding: supplied });
    assert.equal(result.comparisonComplete, true); assert.equal(result.definition.binding.sourceSha, supplied.sourceSha); checkBoundary(result); checkBoundary(result.definition);
  });
  it('never treats --list skipped=149 or caller verified=true as execution success', () => {
    const { scope, report } = fixture(); report.apiVerified = true; report.protectedVerified = true;
    const result = normalizeFullstackDiscovery({ scopeId: scope.scopeId, report, binding: binding(scope) }); assert.equal(result.comparisonComplete, true); checkBoundary(result);
    reject(validate(result.definition, report));
  });
  it('rejects missing source/tree identity or any missing test/config/lock fingerprint', () => {
    const { scope, report } = fixture();
    for (const missing of ['sourceSha', 'sourceTree']) { const supplied = binding(scope); delete supplied[missing]; reject(normalizeFullstackDiscovery({ scopeId: scope.scopeId, report, binding: supplied })); }
    for (const path of [scope.tests[0].file, `apps/web/${scope.selection.config}`, 'pnpm-lock.yaml']) {
      const supplied = binding(scope); supplied.inputFingerprints = supplied.inputFingerprints.filter(value => value.path !== path);
      reject(normalizeFullstackDiscovery({ scopeId: scope.scopeId, report, binding: supplied }), 'definition_input_fingerprint_missing');
    }
  });
  it('rejects duplicate fingerprints and malformed digests', () => {
    const { scope, report } = fixture(); const supplied = binding(scope); supplied.inputFingerprints.push(supplied.inputFingerprints[0]);
    reject(normalizeFullstackDiscovery({ scopeId: scope.scopeId, report, binding: supplied }), 'invalid_or_duplicate_input_fingerprint');
    supplied.inputFingerprints.pop(); supplied.inputFingerprints[0].digest = 'not-a-digest';
    reject(normalizeFullstackDiscovery({ scopeId: scope.scopeId, report, binding: supplied }), 'invalid_or_duplicate_input_fingerprint');
  });
  it('does not evaluate getters or accept class instances, sparse arrays or cycles', () => {
    let invoked = false; const input = {}; Object.defineProperty(input, 'config', { enumerable: true, get() { invoked = true; throw Error('must not run'); } });
    reject(normalizeFullstackDiscovery({ scopeId: 'fullstack-smoke', report: input, binding: {} }), 'non_json_input'); assert.equal(invoked, false);
    for (const value of [new Date(), [, 1]]) assert.throws(() => fullstackDataFingerprint(value), /non_json_input/);
    const cycle = {}; cycle.self = cycle; assert.throws(() => fullstackDataFingerprint(cycle), /non_json_input/);
  });
  it('rejects nested and public-option Proxies before invoking any trap', () => {
    let traps = 0;
    const proxy = new Proxy({}, { get() { traps++; throw Error('get trap'); }, getPrototypeOf() { traps++; throw Error('prototype trap'); }, ownKeys() { traps++; throw Error('keys trap'); }, getOwnPropertyDescriptor() { traps++; throw Error('descriptor trap'); } });
    assert.throws(() => fullstackDataFingerprint(proxy), /non_json_input/);
    assert.throws(() => fullstackDataFingerprint({ nested: proxy }), /non_json_input/);
    assert.throws(() => fullstackTestId(proxy), /non_json_input/);
    assert.throws(() => fullstackLedgerContextDigest({ scopeId: 'fullstack-smoke', definitionDigest: proxy, runContext: context }), /non_json_input/);
    reject(normalizeFullstackDiscovery(proxy), 'non_json_input');
    reject(validateFullstackTerminalLedger(proxy), 'non_json_input');
    reject(compareFullstackLegacyLog(proxy), 'non_json_input');
    reject(normalizeFullstackDiscovery({ scopeId: 'fullstack-smoke', report: proxy, binding: {} }), 'non_json_input');
    assert.equal(traps, 0);
  });
});

describe('discovery drift, focusing, missing projects and list/execution confusion fail closed', () => {
  const mutations = [
    ['unknown project', r => { const row = rows(r)[0]; row.test.projectName = row.test.projectId = 'unknown-project'; }],
    ['duplicate test', r => { const row = rows(r)[0]; row.suite.specs.push(copy(row.spec)); }],
    ['missing test', r => { const row = rows(r)[0]; row.suite.specs.splice(row.suite.specs.indexOf(row.spec), 1); }],
    ['changed title', r => { rows(r)[0].spec.title += ' drift'; }],
    ['changed line', r => { rows(r)[0].spec.line += 1; }],
    ['changed project', r => { const row = rows(r)[0]; row.test.projectName = row.test.projectId = 'realtime-voice'; }],
    ['changed framework ID', r => { rows(r)[0].spec.id = 'fake-framework-id'; }],
    ['new skip', r => { const row = rows(r).find(x => x.test.expectedStatus === 'passed'); row.test.expectedStatus = 'skipped'; row.test.annotations = [{ type: 'fixme' }]; }],
    ['removed fixme', r => { const row = rows(r).find(x => x.test.expectedStatus === 'skipped'); row.test.expectedStatus = 'passed'; row.test.annotations = []; }],
    ['test.only', r => { rows(r)[0].spec.only = true; }],
    ['describe.only', r => { r.suites[0].only = true; }],
    ['test focus', r => { rows(r)[0].test.focused = true; }],
    ['missing dependency project', r => { r.config.projects = r.config.projects.filter(p => p.name !== 'seeded'); }],
    ['repeat each', r => { r.config.projects[0].repeatEach = 2; }],
    ['no dependencies selection', r => { r.config.argv.push('--no-deps'); }],
    ['different project selection', r => { r.config.argv[4] = '--project=seeded'; }],
    ['different config', r => { r.config.argv[3] = 'other.config.ts'; }],
    ['different tool version', r => { r.config.version = '1.63.0'; }],
    ['sharded discovery', r => { r.config.shard = { current: 1, total: 2 }; }],
    ['worker/discovery error', r => { r.errors = [{ message: 'worker crashed' }]; }],
    ['list result forged execution', r => { rows(r)[0].test.results = [{ status: 'passed' }]; }],
    ['list status forged passed', r => { rows(r)[0].test.status = 'passed'; }],
    ['forged counts', r => { r.stats.expected = 148; r.stats.skipped = 1; }],
    ['path traversal', r => { rows(r)[0].spec.file = '../outside.spec.ts'; }],
  ];
  for (const [name, mutate] of mutations) it(`rejects ${name}`, () => {
    const { scope, report } = fixture(); mutate(report); reject(normalizeFullstackDiscovery({ scopeId: scope.scopeId, report, binding: binding(scope) }));
  });
});

describe('complete terminal ledgers have synthetic comparison scope only', () => {
  it('compares all 149 synthetic terminals, explicitly retaining 148 pass and 1 fixme', () => {
    const { definition } = fixture(); const result = validate(definition, ledgerFor(definition));
    assert.equal(result.comparisonComplete, true); assert.equal(result.provenance, 'synthetic');
    assert.deepEqual(result.counts, { total: 149, passed: 148, skipped: 1, failed: 0, flaky: 0, retries: 0 });
    assert.equal(result.skippedTests.length, 1); assert.equal(result.skippedTests[0].file, 'apps/web/e2e/inbox-smoke.spec.ts'); checkBoundary(result);
    assert.equal(result.observedHookCompleteness, 'all-observed-hooks-ended'); assert.equal(result.configuredHookInventoryVerified, false);
  });
  it('independently compares geometry 7, preserving its separate scope', () => {
    const { definition } = fixture('trace-geometry'); const result = validate(definition, ledgerFor(definition));
    assert.equal(result.comparisonComplete, true); assert.equal(result.counts.total, 7); assert.equal(result.skippedTests.length, 0); checkBoundary(result);
  });
  it('does not upgrade perfectly forged provided JSON or receipt authority flags', () => {
    const { definition } = fixture(); const ledger = ledgerFor(definition); ledger.provenance = 'provided';
    Object.assign(ledger, { executionAuthorityVerified: true, apiVerified: true, protectedVerified: true, scopedVerified: true, reuseEligible: true, skip: true, runFull: false });
    const result = validate({ ...definition, executionAuthorityVerified: true, apiVerified: true }, ledger); assert.equal(result.comparisonComplete, true); checkBoundary(result);
  });
  it('rejects a changed definition even if a caller recomputes all claimed counts', () => {
    const { definition } = fixture(); const ledger = ledgerFor(definition); definition.tests[0].titlePath[0] += ' drift'; definition.counts.passed = 149;
    reject(validate(definition, ledger));
  });
  it('rejects source fingerprint changes against the same terminal ledger', () => {
    const { definition } = fixture(); const ledger = ledgerFor(definition); definition.binding.inputFingerprints[0].digest = `sha256:${'a'.repeat(64)}`;
    reject(validate(definition, ledger), 'definition_digest_or_scope_mismatch');
  });
  it('rejects context/run attempt mixing and missing independent expected context', () => {
    const { definition } = fixture(); const ledger = ledgerFor(definition);
    reject(validate(definition, ledger, { ...context, runAttempt: 2 }), 'run_context_mismatch');
    reject(validate(definition, ledger, null));
    event(ledger, 'test-end').contextDigest = fullstackLedgerContextDigest({ scopeId: definition.scopeId, definitionDigest: definition.definitionDigest, runContext: { ...context, runAttempt: 2 } });
    reject(validate(definition, ledger), 'event_sequence_or_run_context_drift');
  });
  it('rejects geometry IDs or scope substituted into the fullstack ledger', () => {
    const { definition } = fixture(); const geometry = fixture('trace-geometry'); const ledger = ledgerFor(definition);
    event(ledger, 'test-begin').testId = geometry.definition.tests[0].id; reject(validate(definition, ledger), 'unexpected_test_identity');
    reject(validate(definition, ledgerFor(geometry.definition)), 'ledger_definition_or_scope_mismatch');
  });
});

describe('negative terminal protocols cannot manufacture successful completion', () => {
  const mutations = [
    ['failed test', l => { event(l, 'test-end').status = 'failed'; }],
    ['flaky test', l => { event(l, 'test-end').status = 'flaky'; }],
    ['new runtime skip', l => { event(l, 'test-end').status = 'skipped'; }],
    ['skip converted to pass', l => { l.events.find(e => e.type === 'test-end' && e.status === 'skipped').status = 'passed'; }],
    ['skip reason removed', l => { l.events.find(e => e.type === 'test-end' && e.status === 'skipped').annotations = []; }],
    ['begin retry', l => { event(l, 'test-begin').attempt = 1; }],
    ['end retry', l => { event(l, 'test-end').attempt = 1; }],
    ['begin omitted', l => { l.events.splice(l.events.indexOf(event(l, 'test-begin')), 1); }],
    ['end omitted', l => { l.events.splice(l.events.indexOf(event(l, 'test-end')), 1); }],
    ['duplicate terminal', l => { const i = l.events.indexOf(event(l, 'test-end')); l.events.splice(i + 1, 0, copy(l.events[i])); }],
    ['unknown test', l => { event(l, 'test-begin').testId = `sha256:${'f'.repeat(64)}`; }],
    ['unknown project', l => { event(l, 'project-begin').project = 'fake'; }],
    ['dependency project reordered', l => { event(l, 'project-begin').project = 'seeded-github-import'; }],
    ['missing project terminal', l => { l.events.splice(l.events.indexOf(event(l, 'project-end')), 1); }],
    ['project count fabricated', l => { event(l, 'project-end').counts.total = 1000; }],
    ['project failed', l => { event(l, 'project-end').status = 'failed'; }],
    ['test error even with passed status', l => { event(l, 'test-end').errors = [{ message: 'caught assertion' }]; }],
    ['worker error', l => { event(l, 'worker-end').errors = [{ message: 'worker crashed' }]; }],
    ['worker failed', l => { event(l, 'worker-end').status = 'failed'; }],
    ['hook failed', l => { event(l, 'hook-end').status = 'failed'; }],
    ['hook error', l => { event(l, 'hook-end').errors = [{ message: 'teardown failed' }]; }],
    ['hook terminal omitted', l => { l.events.splice(l.events.indexOf(event(l, 'hook-end')), 1); }],
    ['suite error', l => { event(l, 'suite-end').errors = [{ message: 'global error' }]; }],
    ['forged suite counts', l => { event(l, 'suite-end').counts.passed = 149; event(l, 'suite-end').counts.skipped = 0; }],
    ['suite end missing', l => { l.events.splice(l.events.indexOf(event(l, 'suite-end')), 1); }],
    ['suite end failed', l => { event(l, 'suite-end').status = 'failed'; }],
    ['fewer suite projects', l => { event(l, 'suite-end').projects.pop(); }],
    ['fewer begin projects', l => { event(l, 'suite-begin').projects.pop(); }],
    ['launcher list mode', l => { l.mode = 'list'; }],
    ['zero exit without events', l => { l.events = [event(l, 'process-terminal')]; }],
    ['nonzero process exit', l => { event(l, 'process-terminal').exitCode = 1; }],
    ['signal process exit', l => { event(l, 'process-terminal').signal = 'SIGKILL'; }],
    ['cancellation', l => { event(l, 'process-terminal').cancelled = true; }],
    ['timeout', l => { event(l, 'process-terminal').timedOut = true; }],
    ['OOM', l => { event(l, 'process-terminal').oomKilled = true; }],
    ['process terminal missing', l => { l.events.splice(l.events.indexOf(event(l, 'process-terminal')), 1); }],
    ['stream drain missing', l => { l.events.pop(); }],
    ['stderr drain missing', l => { event(l, 'output-drained').streams = ['stdout', 'ledger']; }],
    ['event after final drain', l => { l.events.push(copy(event(l, 'process-terminal'))); }],
    ['unknown event', l => { event(l, 'worker-end').type = 'invented-success'; }],
    ['forged extra stats', l => { l.stats = { passed: 149, skipped: 0 }; }],
  ];
  for (const [name, mutate] of mutations) it(`rejects ${name}`, () => {
    const { definition } = fixture(); const ledger = ledgerFor(definition); mutate(ledger); renumber(ledger); reject(validate(definition, ledger));
  });
  for (const type of ['worker-error', 'hook-error', 'global-error', 'runner-error', 'retry', 'cancel', 'timeout']) it(`rejects explicit ${type} events`, () => {
    const { definition } = fixture(); const ledger = ledgerFor(definition); const marker = { seq: 0, contextDigest: ledger.events[0].contextDigest, type }; ledger.events.splice(5, 0, marker); renumber(ledger);
    reject(validate(definition, ledger), `${type}_reported`);
  });
  it('rejects reordered/duplicated sequence numbers independently of event payload', () => {
    const { definition } = fixture(); const ledger = ledgerFor(definition); ledger.events[8].seq = ledger.events[7].seq;
    reject(validate(definition, ledger), 'event_sequence_or_run_context_drift');
  });
  it('rejects worker ownership changes within a test or its hook', () => {
    const { definition } = fixture(); const ledger = ledgerFor(definition); event(ledger, 'test-end').workerId = 'other-worker'; reject(validate(definition, ledger));
    const another = ledgerFor(definition); another.events.splice(2, 0, { ...another.events[1], workerId: 'other-worker' }); renumber(another);
    another.events.find(e => e.type === 'hook-begin' && e.testId !== null).workerId = 'other-worker'; reject(validate(definition, another), 'hook_context_mismatch');
  });
  it('rejects project execution before a started global setup hook ends', () => {
    const { definition } = fixture('trace-geometry'); const ledger = ledgerFor(definition);
    const index = ledger.events.findIndex(e => e.type === 'hook-end' && e.hookId === 'synthetic-global-setup');
    const [setupEnd] = ledger.events.splice(index, 1); ledger.events.splice(ledger.events.indexOf(event(ledger, 'worker-end')), 0, setupEnd); renumber(ledger);
    reject(validate(definition, ledger), 'global_setup_incomplete');
  });
  it('rejects global teardown before workers reach terminal state', () => {
    const { definition } = fixture('trace-geometry'); const ledger = ledgerFor(definition);
    const index = ledger.events.indexOf(event(ledger, 'worker-end')); const [workerEnd] = ledger.events.splice(index, 1);
    ledger.events.splice(ledger.events.indexOf(event(ledger, 'suite-end')), 0, workerEnd); renumber(ledger);
    reject(validate(definition, ledger), 'invalid_global_hook');
  });
  it('rejects a suite end with a started global teardown hook still unfinished', () => {
    const { definition } = fixture('trace-geometry'); const ledger = ledgerFor(definition);
    const index = ledger.events.findIndex(e => e.type === 'hook-end' && e.hookId === 'synthetic-global-teardown');
    ledger.events.splice(index, 1); renumber(ledger); reject(validate(definition, ledger), 'suite_inventory_worker_or_hook_incomplete');
  });
});

describe('legacy reporter text compares observed identities without authenticating execution', () => {
  function legacy(definition) {
    return [`2026-10-05T16:00:00Z Running ${definition.tests.length} tests using 2 workers`, ...definition.tests.map((test, index) => `2026-10-05T16:00:01Z ${definition.scopeId === 'trace-geometry' ? `  ✓  ${index + 1}` : `[${index + 1}/${definition.tests.length}]`} [${test.project}] › e2e/${test.file.replace('apps/web/e2e/', '')}:${test.line}:${test.column} › ${test.titlePath.join(' › ')}${definition.scopeId === 'trace-geometry' ? ' (1.4s)' : ''}`), ...(definition.counts.skipped ? [`2026-10-05T16:01:00Z   ${definition.counts.skipped} skipped`] : []), `2026-10-05T16:01:00Z   ${definition.counts.passed} passed (synthetic log fixture)`].join('\n');
  }
  it('compares all real observed IDs in a synthetic text fixture, with no authority', () => {
    const { definition } = fixture(); const result = compareFullstackLegacyLog({ definition, log: legacy(definition) });
    assert.equal(result.comparisonComplete, true); assert.deepEqual(result.observedTerminalCounts, { passed: 148, skipped: 1, failed: 0, flaky: 0 }); checkBoundary(result);
    assert.ok(result.reasons.includes('legacy_log_has_no_authenticated_terminal_protocol'));
  });
  it('rejects old-style retry/flaky, missing rows, fake counts and list JSON text', () => {
    const { definition, report } = fixture(); const log = legacy(definition);
    for (const mutated of [log.replace('[1/149]', '[1/149] (retries)').replace(definition.tests[0].titlePath.join(' › '), `${definition.tests[0].titlePath.join(' › ')} (retry #1)`), `${log}\n2026-10-05T16:01:00Z   1 flaky`, log.split('\n').filter(line => !line.includes('[1/149]')).join('\n'), log.replace('148 passed', '149 passed'), JSON.stringify(report)]) reject(compareFullstackLegacyLog({ definition, log: mutated }));
  });
  it('keeps geometry in a separate 7-test comparison scope', () => {
    const fullstack = fixture().definition, geometry = fixture('trace-geometry').definition;
    const combined = `${legacy(fullstack)}\n${legacy(geometry)}`;
    assert.equal(compareFullstackLegacyLog({ definition: fullstack, log: combined }).comparisonComplete, true);
    const result = compareFullstackLegacyLog({ definition: geometry, log: combined }); assert.equal(result.comparisonComplete, true); assert.equal(result.observedTerminalCounts.passed, 7); checkBoundary(result);
  });
});
