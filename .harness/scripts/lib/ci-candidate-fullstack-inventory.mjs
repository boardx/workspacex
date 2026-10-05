/**
 * FS01: pure-data comparison against one checked-in discovery observation.
 * Nothing here runs/imports candidate config, discovers tests, authenticates a
 * reporter, or attests a source/runtime boundary. Even perfectly forged JSON
 * can only pass a metadata comparison; execution authority ALWAYS stays false.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { types } from 'node:util';

export const FULLSTACK_INVENTORY_VERSION = 1;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const LIMITS = { nodes: 100_000, depth: 40, string: 32_768, events: 20_000 };
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && typeof value === 'object' && !types.isProxy(value) && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const safePath = value => typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.includes('\\') && !/[\x00-\x1f\x7f]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
const text = value => typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\x7f]/.test(value);
const sortText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
class ComparisonError extends Error { constructor(reason) { super(reason); this.reason = reason; } }
const check = (value, reason) => { if (!value) throw new ComparisonError(reason); };

/** Reject accessors, prototypes, non-JSON values, cycles and oversized input. */
function data(value) {
  if (typeof value === 'string') { check(Buffer.byteLength(value) <= 4 * 1024 * 1024, 'json_input_budget_exceeded'); value = JSON.parse(value); }
  let nodes = 0; const active = new Set();
  const clone = (item, depth) => {
    check(++nodes <= LIMITS.nodes && depth <= LIMITS.depth, 'json_input_budget_exceeded');
    check(!types.isProxy(item), 'non_json_input');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') { check(Number.isFinite(item), 'non_json_input'); return item; }
    if (typeof item === 'string') { check(item.length <= LIMITS.string, 'json_input_budget_exceeded'); return item; }
    check(Array.isArray(item) || plain(item), 'non_json_input');
    check(!active.has(item) && Object.getOwnPropertySymbols(item).length === 0, 'non_json_input'); active.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const result = Array.isArray(item) ? [] : {};
    for (const key of Object.keys(descriptors)) {
      if (Array.isArray(item) && key === 'length') continue;
      check(!['__proto__', 'prototype', 'constructor'].includes(key) && own(descriptors[key], 'value') && descriptors[key].enumerable, 'non_json_input');
      if (Array.isArray(item)) check(/^\d+$/.test(key) && Number(key) < item.length, 'non_json_input');
      result[key] = clone(descriptors[key].value, depth + 1);
    }
    if (Array.isArray(item)) check(result.length === item.length && Object.keys(result).length === item.length, 'non_json_input');
    active.delete(item); return result;
  };
  return clone(value, 0);
}
function optionsFor(value) {
  check(!types.isProxy(value) && plain(value), 'non_json_input');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  check(Object.getOwnPropertySymbols(value).length === 0 && Object.values(descriptors).every(descriptor => own(descriptor, 'value') && descriptor.enumerable), 'non_json_input');
  check(!Object.keys(descriptors).some(key => ['__proto__', 'prototype', 'constructor'].includes(key)), 'non_json_input');
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort(sortText).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const fullstackDataFingerprint = value => `sha256:${createHash('sha256').update(canonical(data(value))).digest('hex')}`;
const same = (a, b) => canonical(a) === canonical(b);
function keys(value, required, optional = []) {
  check(plain(value) && required.every(key => own(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), 'schema_mismatch');
}
const boundary = () => ({ metadataOnly: true, executionAuthorityVerified: false, sourceBindingAuthorityVerified: false, configuredHookInventoryVerified: false, apiVerified: false, protectedVerified: false, scopedVerified: false, reuseEligible: false, skip: false, runFull: true });
const outcome = kind => ({ schemaVersion: FULLSTACK_INVENTORY_VERSION, kind, ...boundary(), comparisonComplete: false, reasons: ['provided_data_is_not_execution_authority'] });
function failed(result, error) { result.reasons.push(error instanceof ComparisonError ? error.reason : 'data_read_or_validation_error'); return result; }

/** IDs bind parameterized titles and the fixed repeat index as well as location. */
export function fullstackTestId(input) {
  const test = data(input);
  return fullstackDataFingerprint({ project: test.project, file: test.file, line: test.line, column: test.column, titlePath: test.titlePath, repeatEachIndex: test.repeatEachIndex });
}
function annotationTypes(value) {
  check(Array.isArray(value), 'annotations_missing');
  return value.map(annotation => {
    check(plain(annotation) && text(annotation.type), 'invalid_annotation');
    return { type: annotation.type };
  });
}
function normalizedTest(value) {
  keys(value, ['project', 'file', 'line', 'column', 'titlePath', 'repeatEachIndex', 'frameworkId', 'expectedStatus', 'annotations'], ['id']);
  check(text(value.project) && safePath(value.file) && value.file.startsWith('apps/web/e2e/') && Number.isSafeInteger(value.line) && value.line > 0 && Number.isSafeInteger(value.column) && value.column > 0 && Array.isArray(value.titlePath) && value.titlePath.length > 0 && value.titlePath.every(text) && value.repeatEachIndex === 0 && text(value.frameworkId), 'invalid_test_identity');
  check(['passed', 'skipped'].includes(value.expectedStatus), 'unsupported_expected_status');
  const test = { project: value.project, file: value.file, line: value.line, column: value.column, titlePath: value.titlePath, repeatEachIndex: 0, frameworkId: value.frameworkId, expectedStatus: value.expectedStatus, annotations: annotationTypes(value.annotations) };
  test.id = fullstackTestId(test);
  if (own(value, 'id')) check(value.id === test.id, 'test_identity_digest_mismatch');
  return test;
}
function counts(tests, dag) { return { tests: tests.length, files: new Set(tests.map(test => test.file)).size, projects: Object.keys(dag).length, passed: tests.filter(test => test.expectedStatus === 'passed').length, skipped: tests.filter(test => test.expectedStatus === 'skipped').length }; }
function validateDag(dag, selected) {
  check(plain(dag) && text(selected) && own(dag, selected), 'invalid_project_dag');
  const visiting = new Set(), visited = new Set();
  const visit = project => {
    check(text(project) && Array.isArray(dag[project]) && new Set(dag[project]).size === dag[project].length && dag[project].every(dependency => own(dag, dependency)), 'invalid_project_dag');
    check(!visiting.has(project), 'cyclic_project_dag');
    if (visited.has(project)) return;
    visiting.add(project); dag[project].forEach(visit); visiting.delete(project); visited.add(project);
  };
  visit(selected); check(visited.size === Object.keys(dag).length, 'unreachable_project_in_scope');
}

// This is an observation/fixture, never a product contract or trusted authority.
const observation = data(JSON.parse(readFileSync(new URL('../../config/ci-fullstack-inventory.json', import.meta.url), 'utf8')));
check(observation.schemaVersion === 1 && observation.kind === 'fullstack-inventory-observation' && observation.metadataOnly === true && observation.executionAuthorityVerified === false && Array.isArray(observation.scopes), 'invalid_inventory_observation');
const scopes = new Map();
for (const value of observation.scopes) {
  check(text(value.scopeId) && !scopes.has(value.scopeId), 'duplicate_scope');
  validateDag(value.projectDag, value.selection.project);
  const tests = value.tests.map(normalizedTest).sort((a, b) => sortText(a.id, b.id));
  check(new Set(tests.map(test => test.id)).size === tests.length && same(counts(tests, value.projectDag), value.expectedCounts), 'invalid_inventory_observation');
  check(tests.every(test => own(value.projectDag, test.project) && (test.expectedStatus === 'passed' ? test.annotations.length === 0 : same(test.annotations, [{ type: 'fixme' }]))), 'invalid_inventory_observation');
  check(Array.isArray(value.requiredInputPaths) && value.requiredInputPaths.every(safePath) && value.selection.repeatEach === 1, 'invalid_inventory_observation');
  scopes.set(value.scopeId, { ...value, tests });
}
export function fullstackScopeObservation(scopeId) { check(scopes.has(scopeId), 'unknown_scope'); return data(scopes.get(scopeId)); }
function scopeFor(scopeId) { check(scopes.has(scopeId), 'unknown_scope'); return scopes.get(scopeId); }

function bindingFor(value, scope) {
  keys(value, ['sourceSha', 'sourceTree', 'inputFingerprints'], ['sourceInputDigest', 'dependencyInputDigest', 'runtimeInputDigest']);
  check(SHA.test(value.sourceSha ?? '') && SHA.test(value.sourceTree ?? '') && value.sourceSha.length === value.sourceTree.length, 'source_binding_missing');
  check(Array.isArray(value.inputFingerprints) && value.inputFingerprints.length > 0, 'input_fingerprints_missing');
  const paths = new Set();
  const fingerprints = value.inputFingerprints.map(input => {
    keys(input, ['path', 'digest']); check(safePath(input.path) && DIGEST.test(input.digest ?? '') && !paths.has(input.path), 'invalid_or_duplicate_input_fingerprint'); paths.add(input.path); return input;
  }).sort((a, b) => sortText(a.path, b.path));
  check(scope.requiredInputPaths.every(path => paths.has(path)), 'definition_input_fingerprint_missing');
  for (const key of ['sourceInputDigest', 'dependencyInputDigest', 'runtimeInputDigest']) if (own(value, key)) check(DIGEST.test(value[key] ?? ''), 'invalid_input_fingerprint');
  return { ...value, inputFingerprints: fingerprints };
}
function definitionFor(scope, binding, tests) {
  const payload = { schemaVersion: 1, kind: 'fullstack-inventory-definition-metadata', scopeId: scope.scopeId, selection: scope.selection, playwrightVersion: scope.playwrightVersion, projectDag: scope.projectDag, tests, counts: counts(tests, scope.projectDag), binding };
  return { ...payload, ...boundary(), comparisonComplete: true, inventoryComplete: true, definitionDigest: fullstackDataFingerprint(payload), reasons: ['provided_data_is_not_execution_authority'] };
}
function exactTests(tests, scope) {
  check(new Set(tests.map(test => test.id)).size === tests.length, 'duplicate_test_identity');
  check(new Set(tests.map(test => `${test.project}:${test.frameworkId}`)).size === tests.length, 'duplicate_framework_test_identity');
  check(tests.every(test => own(scope.projectDag, test.project)), 'unknown_project');
  check(tests.length === scope.tests.length, 'test_inventory_missing_or_extra');
  const sorted = [...tests].sort((a, b) => sortText(a.id, b.id));
  check(same(sorted, scope.tests), 'test_definition_drift_or_new_skip');
  return sorted;
}
function parseDefinition(raw) {
  const definition = data(raw), scope = scopeFor(definition.scopeId);
  check(definition.schemaVersion === 1 && definition.kind === 'fullstack-inventory-definition-metadata' && Array.isArray(definition.tests), 'invalid_definition');
  const expected = definitionFor(scope, bindingFor(definition.binding, scope), exactTests(definition.tests.map(normalizedTest), scope));
  check(same(definition.selection, expected.selection) && same(definition.projectDag, expected.projectDag) && definition.playwrightVersion === expected.playwrightVersion && same(definition.counts, expected.counts) && definition.definitionDigest === expected.definitionDigest, 'definition_digest_or_scope_mismatch');
  return expected;
}

/** Normalizes actual --list data; `results=[]` is deliberately not execution. */
export function normalizeFullstackDiscovery(options = {}) {
  const result = outcome('fullstack-discovery-comparison-metadata'); result.definition = null;
  try {
    const { scopeId, report: input, binding: inputBinding } = optionsFor(options);
    const scope = scopeFor(scopeId), report = data(input), binding = bindingFor(data(inputBinding), scope);
    check(plain(report) && plain(report.config) && Array.isArray(report.suites) && Array.isArray(report.errors) && report.errors.length === 0 && plain(report.stats), 'invalid_discovery_report');
    const expectedArgv = ['test', '--config', scope.selection.config, ...(scopeId === 'fullstack-smoke' ? [`--project=${scope.selection.project}`] : []), '--list', '--reporter=json'];
    check(Array.isArray(report.config.argv) && same(report.config.argv.slice(2), expectedArgv) && report.config.version === scope.playwrightVersion && report.config.shard === null, 'discovery_selection_or_toolchain_drift');
    check(Array.isArray(report.config.projects) && new Set(report.config.projects.map(project => project.name)).size === report.config.projects.length, 'invalid_configured_projects');
    const configured = new Map(report.config.projects.map(project => [project.name, project]));
    check(Object.keys(scope.projectDag).every(project => configured.has(project) && configured.get(project).repeatEach === 1), 'project_missing_or_repeat_drift');
    const tests = [];
    const walk = (suite, titlePath) => {
      check(plain(suite) && suite.only !== true && suite.focused !== true && suite.exclusive !== true && (!own(suite, 'specs') || Array.isArray(suite.specs)) && (!own(suite, 'suites') || Array.isArray(suite.suites)), 'focused_or_invalid_suite');
      for (const spec of suite.specs ?? []) {
        check(plain(spec) && spec.only !== true && spec.focused !== true && spec.exclusive !== true && spec.ok === true && text(spec.title) && Array.isArray(spec.tests) && spec.tests.length > 0, 'focused_or_invalid_spec');
        for (const test of spec.tests) {
          check(plain(test) && test.only !== true && test.focused !== true && test.exclusive !== true && test.projectId === test.projectName && Array.isArray(test.results) && test.results.length === 0 && test.status === 'skipped', 'list_report_contains_execution_or_focus');
          const file = spec.file?.startsWith('apps/web/e2e/') ? spec.file : `apps/web/e2e/${spec.file}`;
          tests.push(normalizedTest({ project: test.projectName, file, line: spec.line, column: spec.column, titlePath: [...titlePath, spec.title], repeatEachIndex: 0, frameworkId: spec.id, expectedStatus: test.expectedStatus, annotations: test.annotations }));
        }
      }
      for (const child of suite.suites ?? []) { check(text(child.title), 'invalid_suite_title'); walk(child, [...titlePath, child.title]); }
    };
    report.suites.forEach(suite => walk(suite, []));
    const exact = exactTests(tests, scope);
    check(report.stats.expected === 0 && report.stats.skipped === exact.length && report.stats.unexpected === 0 && report.stats.flaky === 0, 'forged_or_non_discovery_counts');
    result.definition = definitionFor(scope, binding, exact); result.inventoryComplete = true; result.comparisonComplete = true;
  } catch (error) { failed(result, error); }
  return result;
}

function runContextFor(raw) {
  const value = data(raw); keys(value, ['repository', 'runId', 'jobId', 'runAttempt', 'sessionId']);
  const identifier = item => (typeof item === 'number' && Number.isSafeInteger(item) && item > 0) || (typeof item === 'string' && /^[1-9]\d{0,15}$/.test(item));
  check(value.repository === 'boardx/workspacex' && identifier(value.runId) && identifier(value.jobId) && Number.isSafeInteger(value.runAttempt) && value.runAttempt > 0 && /^[a-zA-Z0-9_-]{16,128}$/.test(value.sessionId ?? ''), 'invalid_run_context');
  return { ...value, runId: String(value.runId), jobId: String(value.jobId) };
}
export function fullstackLedgerContextDigest(options) {
  const { scopeId, definitionDigest, runContext } = data(options);
  scopeFor(scopeId); check(typeof definitionDigest === 'string' && DIGEST.test(definitionDigest), 'definition_digest_missing');
  return fullstackDataFingerprint({ scopeId, definitionDigest, runContext: runContextFor(runContext) });
}
const eventFields = {
  'suite-begin': ['scopeId', 'definitionDigest', 'mode', 'totalTests', 'projects'],
  'worker-start': ['workerId'], 'worker-end': ['workerId', 'status', 'errors'],
  'project-begin': ['project'], 'project-end': ['project', 'status', 'counts'],
  'test-begin': ['testId', 'workerId', 'attempt'],
  'test-end': ['testId', 'workerId', 'attempt', 'status', 'annotations', 'errors'],
  'hook-begin': ['hookId', 'project', 'workerId', 'testId', 'hookKind'],
  'hook-end': ['hookId', 'status', 'errors'],
  'suite-end': ['status', 'counts', 'projects', 'errors'],
  'process-terminal': ['exitCode', 'signal', 'cancelled', 'timedOut', 'oomKilled'],
  'output-drained': ['streams'],
};
function actualCounts(tests) { return { total: tests.length, passed: tests.filter(test => test.status === 'passed').length, skipped: tests.filter(test => test.status === 'skipped').length, failed: 0, flaky: 0, retries: 0 }; }
function noErrors(value, reason) { check(Array.isArray(value) && value.length === 0, reason); }

/**
 * Full lifecycle validation of an UNAUTHENTICATED, ordered event collection.
 * A synthetic ledger can be comparisonComplete, but never a trusted completion.
 * Runtime/supervisor authentication is intentionally outside this module.
 */
export function validateFullstackTerminalLedger(options = {}) {
  const result = outcome('fullstack-terminal-comparison-metadata');
  try {
    const { definition: inputDefinition, ledger: inputLedger, expectedRunContext } = optionsFor(options);
    const definition = parseDefinition(inputDefinition), ledger = data(inputLedger), scope = scopeFor(definition.scopeId);
    keys(ledger, ['schemaVersion', 'kind', 'mode', 'provenance', 'scopeId', 'definitionDigest', 'runContext', 'events'], ['executionAuthorityVerified', 'apiVerified', 'protectedVerified', 'scopedVerified', 'reuseEligible', 'skip', 'runFull']);
    check(ledger.schemaVersion === 1 && ledger.kind === 'fullstack-terminal-ledger-metadata' && ledger.mode === 'execution-metadata' && ['synthetic', 'provided'].includes(ledger.provenance), 'list_or_unknown_data_is_not_terminal_ledger');
    check(ledger.scopeId === definition.scopeId && ledger.definitionDigest === definition.definitionDigest, 'ledger_definition_or_scope_mismatch');
    const runContext = runContextFor(ledger.runContext);
    check(same(runContext, runContextFor(expectedRunContext)), 'run_context_mismatch');
    const contextDigest = fullstackLedgerContextDigest({ scopeId: definition.scopeId, definitionDigest: definition.definitionDigest, runContext });
    check(Array.isArray(ledger.events) && ledger.events.length > 0 && ledger.events.length <= LIMITS.events, 'terminal_events_missing_or_excessive');
    const expectedTests = new Map(definition.tests.map(test => [test.id, test]));
    const tests = new Map(), projects = new Map(), workers = new Map(), hooks = new Map(); let stage = 'before', seq = 0;
    for (const event of ledger.events) {
      check(plain(event) && event.seq === ++seq && event.contextDigest === contextDigest, 'event_sequence_or_run_context_drift');
      check(!['worker-error', 'hook-error', 'global-error', 'runner-error', 'retry', 'cancel', 'timeout'].includes(event.type), `${event.type}_reported`);
      check(own(eventFields, event.type), 'unknown_terminal_event');
      keys(event, ['seq', 'type', 'contextDigest', ...eventFields[event.type]]);
      if (stage !== 'running') check((stage === 'before' && event.type === 'suite-begin') || (stage === 'ended' && event.type === 'process-terminal') || (stage === 'terminal' && event.type === 'output-drained'), 'event_outside_suite_lifecycle');
      if (event.type === 'suite-begin') {
        check(stage === 'before' && event.scopeId === definition.scopeId && event.definitionDigest === definition.definitionDigest && event.mode === 'execution-metadata' && event.totalTests === expectedTests.size && same([...event.projects].sort(sortText), Object.keys(scope.projectDag).sort(sortText)), 'invalid_suite_begin'); stage = 'running';
      } else if (event.type === 'worker-start') {
        check(text(event.workerId) && !workers.has(event.workerId), 'duplicate_or_invalid_worker'); workers.set(event.workerId, 'running');
      } else if (event.type === 'worker-end') {
        check(workers.get(event.workerId) === 'running' && event.status === 'completed' && ![...tests.values()].some(test => test.workerId === event.workerId && test.status === 'running') && ![...hooks.values()].some(hook => hook.workerId === event.workerId && hook.status === 'running'), 'worker_incomplete_or_failed'); noErrors(event.errors, 'worker_error_reported'); workers.set(event.workerId, 'completed');
      } else if (event.type === 'project-begin') {
        check(![...hooks.values()].some(hook => hook.hookKind === 'globalSetup' && hook.status === 'running'), 'global_setup_incomplete');
        check(own(scope.projectDag, event.project), 'unknown_project'); check(!projects.has(event.project) && scope.projectDag[event.project].every(dependency => projects.get(dependency) === 'completed'), 'project_dependency_or_duplicate_begin'); projects.set(event.project, 'running');
      } else if (event.type === 'project-end') {
        check(projects.get(event.project) === 'running' && event.status === 'completed', 'project_incomplete_or_failed');
        const wanted = definition.tests.filter(test => test.project === event.project), actual = [...tests.values()].filter(test => test.project === event.project);
        check(actual.length === wanted.length && actual.every(test => ['passed', 'skipped'].includes(test.status)) && ![...hooks.values()].some(hook => hook.project === event.project && hook.status === 'running') && same(event.counts, actualCounts(actual)), 'project_inventory_or_counts_incomplete'); projects.set(event.project, 'completed');
      } else if (event.type === 'test-begin') {
        check(![...hooks.values()].some(hook => hook.hookKind === 'globalSetup' && hook.status === 'running'), 'global_setup_incomplete');
        const test = expectedTests.get(event.testId); check(test, 'unexpected_test_identity');
        check(!tests.has(event.testId) && event.attempt === 0 && workers.get(event.workerId) === 'running' && projects.get(test.project) === 'running', 'duplicate_retry_or_unstarted_test'); tests.set(event.testId, { ...test, workerId: event.workerId, status: 'running' });
      } else if (event.type === 'test-end') {
        const test = tests.get(event.testId); check(test && test.status === 'running' && test.workerId === event.workerId && event.attempt === 0 && workers.get(event.workerId) === 'running', 'unstarted_duplicate_retry_or_worker_drift');
        check(![...hooks.values()].some(hook => hook.testId === event.testId && hook.status === 'running'), 'test_hook_incomplete');
        noErrors(event.errors, 'test_error_reported'); check(event.status === test.expectedStatus && same(annotationTypes(event.annotations), test.annotations), 'test_failed_flaky_or_new_skip');
        tests.set(event.testId, { ...test, status: event.status });
      } else if (event.type === 'hook-begin') {
        check(text(event.hookId) && !hooks.has(event.hookId) && ['beforeAll', 'afterAll', 'beforeEach', 'afterEach', 'globalSetup', 'globalTeardown'].includes(event.hookKind), 'invalid_or_duplicate_hook');
        if (event.project === null) check(event.workerId === null && event.testId === null && ((event.hookKind === 'globalSetup' && projects.size === 0 && tests.size === 0) || (event.hookKind === 'globalTeardown' && projects.size === Object.keys(scope.projectDag).length && [...projects.values()].every(status => status === 'completed') && workers.size > 0 && [...workers.values()].every(status => status === 'completed'))), 'invalid_global_hook');
        else check(!['globalSetup', 'globalTeardown'].includes(event.hookKind) && projects.get(event.project) === 'running' && workers.get(event.workerId) === 'running' && (event.testId === null || (tests.get(event.testId)?.status === 'running' && tests.get(event.testId)?.project === event.project && tests.get(event.testId)?.workerId === event.workerId)), 'hook_context_mismatch');
        hooks.set(event.hookId, { ...event, status: 'running' });
      } else if (event.type === 'hook-end') {
        const hook = hooks.get(event.hookId); check(hook?.status === 'running' && event.status === 'passed', 'hook_incomplete_or_failed'); noErrors(event.errors, 'hook_error_reported'); hooks.set(event.hookId, { ...hook, status: 'passed' });
      } else if (event.type === 'suite-end') {
        check(tests.size === expectedTests.size && [...tests.values()].every(test => ['passed', 'skipped'].includes(test.status)) && projects.size === Object.keys(scope.projectDag).length && [...projects.values()].every(status => status === 'completed') && workers.size > 0 && [...workers.values()].every(status => status === 'completed') && [...hooks.values()].every(hook => hook.status === 'passed'), 'suite_inventory_worker_or_hook_incomplete');
        noErrors(event.errors, 'suite_error_reported'); check(event.status === 'passed' && same(event.counts, actualCounts([...tests.values()])) && same([...event.projects].sort(sortText), Object.keys(scope.projectDag).sort(sortText)), 'forged_suite_counts_or_status'); stage = 'ended';
      } else if (event.type === 'process-terminal') {
        check(stage === 'ended' && event.exitCode === 0 && event.signal === null && event.cancelled === false && event.timedOut === false && event.oomKilled === false, 'process_failed_cancelled_or_incomplete'); stage = 'terminal';
      } else if (event.type === 'output-drained') {
        check(stage === 'terminal' && same(event.streams, ['stdout', 'stderr', 'ledger']), 'output_not_fully_drained'); stage = 'drained';
      }
    }
    check(stage === 'drained', 'suite_end_process_terminal_or_drain_missing');
    result.comparisonComplete = true; result.scopeId = definition.scopeId; result.definitionDigest = definition.definitionDigest; result.contextDigest = contextDigest; result.provenance = ledger.provenance; result.counts = actualCounts([...tests.values()]); result.skippedTests = [...tests.values()].filter(test => test.status === 'skipped').map(test => ({ id: test.id, project: test.project, file: test.file, titlePath: test.titlePath, annotations: test.annotations })); result.observedHooks = hooks.size; result.observedHookCompleteness = 'all-observed-hooks-ended'; result.observedWorkers = workers.size;
  } catch (error) { failed(result, error); }
  return result;
}

/** Actual legacy stdout supports inventory comparison only, never lifecycle trust. */
export function compareFullstackLegacyLog(options = {}) {
  const result = outcome('legacy-fullstack-log-comparison-metadata');
  try {
    const { definition: inputDefinition, log } = optionsFor(options);
    const definition = parseDefinition(inputDefinition);
    check(typeof log === 'string' && Buffer.byteLength(log) <= 8 * 1024 * 1024, 'invalid_legacy_log');
    const clean = log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''), total = definition.tests.length, rows = [];
    const lines = clean.split('\n'), starts = lines.map((line, index) => line.includes(`Running ${total} tests using `) ? index : -1).filter(index => index >= 0);
    check(starts.length === 1, 'legacy_suite_begin_missing_or_duplicate');
    const nextSuite = lines.findIndex((line, index) => index > starts[0] && /Running \d+ tests using /.test(line));
    const selectedLines = lines.slice(starts[0], nextSuite < 0 ? undefined : nextSuite), summaries = new Map();
    const pattern = new RegExp(`\\[(\\d+)/${total}\\](?: \\(retries\\))? \\[([^\\]]+)\\] › e2e/(.*?):(\\d+):(\\d+) › (.*)`);
    const listPattern = /^\S+\s+✓\s+(\d+) \[([^\]]+)\] › e2e\/(.*?):(\d+):(\d+) › (.*) \(\d+(?:\.\d+)?(?:ms|s|m)\)$/;
    for (const line of selectedLines) {
      const summary = /^\S+\s+(\d+) (passed|skipped|failed|flaky)(?:\s|$)/.exec(line);
      if (summary) { check(!summaries.has(summary[2]), 'legacy_duplicate_terminal_summary'); summaries.set(summary[2], Number(summary[1])); }
      const match = pattern.exec(line) ?? listPattern.exec(line); if (!match) continue;
      check(!/\(retry #\d+\)/.test(match[6]), 'legacy_retry_reported');
      rows.push({ project: match[2], file: `apps/web/e2e/${match[3]}`, line: Number(match[4]), column: Number(match[5]), titlePath: match[6].trimEnd().split(' › '), repeatEachIndex: 0 });
    }
    const ids = rows.map(fullstackTestId), wanted = definition.tests.map(test => test.id).sort(sortText);
    check(ids.length === total && new Set(ids).size === total && same([...ids].sort(sortText), wanted), 'legacy_inventory_missing_duplicate_or_extra');
    check((summaries.get('failed') ?? 0) === 0 && (summaries.get('flaky') ?? 0) === 0, 'legacy_failed_or_flaky_reported');
    check(summaries.get('passed') === definition.counts.passed && (summaries.get('skipped') ?? 0) === definition.counts.skipped, 'legacy_terminal_counts_missing_or_forged');
    result.inventoryComparisonComplete = true; result.comparisonComplete = true; result.expectedCounts = definition.counts; result.observedTerminalCounts = { passed: summaries.get('passed'), skipped: summaries.get('skipped') ?? 0, failed: 0, flaky: 0 }; result.logDigest = `sha256:${createHash('sha256').update(log).digest('hex')}`;
    result.reasons.push('legacy_log_has_no_authenticated_terminal_protocol');
  } catch (error) { failed(result, error); }
  return result;
}
