/** Explicit hosted-only AIDT evidence; never a deployment or live-model verdict. */
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyAidtNativeCheckout } from './ci-fullstack-runtime.mjs';

const CONFIG = 'apps/web/playwright.aidt-native.config.ts';
const OUTPUT = 'apps/web/test-results/aidt-native';
// Playwright removes OUTPUT before running. Admission evidence must be a sibling.
const CONTROL_OUTPUT = 'apps/web/test-results/aidt-native-control';

/** The candidate config remains the sole spec inventory; no copied case count. */
export function declaredNativeSpecs(source) {
  const matches = [...source.matchAll(/^\s*testMatch:\s*(\[[\s\S]*?\])/gm)];
  if (matches.length !== 1) throw new Error('AIDT_NATIVE_SPEC_INVENTORY_INVALID');
  let names;
  try { names = JSON.parse(matches[0][1]); } catch { throw new Error('AIDT_NATIVE_SPEC_INVENTORY_INVALID'); }
  if (!Array.isArray(names) || names.length === 0 || names.length > 50 || new Set(names).size !== names.length
      || names.some(name => typeof name !== 'string' || !/^[a-z0-9-]+\.spec\.ts$/.test(name))) throw new Error('AIDT_NATIVE_SPEC_INVENTORY_INVALID');
  return names;
}

function outputDirectory(root, directory = OUTPUT) {
  let current = root;
  for (const part of directory.split('/')) {
    current = join(current, part);
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('AIDT_NATIVE_OUTPUT_UNSAFE');
    mkdirSync(current, { recursive: true });
  }
  return current;
}

function safeFile(path) {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error('AIDT_NATIVE_OUTPUT_UNSAFE');
}

function readJson(path) {
  safeFile(path);
  if (!existsSync(path) || statSync(path).size > 20_000_000) throw new Error('AIDT_NATIVE_EVIDENCE_MISSING');
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('AIDT_NATIVE_EVIDENCE_INVALID'); }
}

export function prepareNative(root, env, now = new Date()) {
  const source = verifyAidtNativeCheckout(root, env);
  const specs = declaredNativeSpecs(readFileSync(resolve(root, CONFIG), 'utf8'));
  const output = outputDirectory(root);
  const controlOutput = outputDirectory(root, CONTROL_OUTPUT);
  for (const file of [join(output, 'results.json'), join(controlOutput, 'verdict.json')]) {
    safeFile(file); if (existsSync(file)) unlinkSync(file);
  }
  const request = { schemaVersion: 1, sourceSha: source, controlSha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, startedAt: now.toISOString(), declaredSpecs: specs };
  const file = join(controlOutput, 'request.json'); safeFile(file);
  writeFileSync(file, JSON.stringify(request, null, 2));
  return request;
}

/** Playwright 1.62 reports files relative to config.rootDir. Preserve all retries. */
export function nativeVerdict(report, request, { root, sourceSha, controlSha, runId, runAttempt, stepOutcome }) {
  const fail = code => { throw new Error(code); };
  if (!['success', 'failure', 'cancelled', 'skipped'].includes(stepOutcome)) fail('AIDT_NATIVE_TEST_OUTCOME_INVALID');
  if (request?.schemaVersion !== 1 || request.sourceSha !== sourceSha || request.controlSha !== controlSha
      || request.runId !== runId || request.runAttempt !== runAttempt) fail('AIDT_NATIVE_REQUEST_MISMATCH');
  const declared = request.declaredSpecs;
  if (!Array.isArray(declared) || !declared.length || new Set(declared).size !== declared.length) fail('AIDT_NATIVE_SPEC_INVENTORY_INVALID');
  const expectedRoot = resolve(root, 'apps/web/e2e');
  if (resolve(report?.config?.rootDir ?? '') !== expectedRoot) fail('AIDT_NATIVE_REPORT_ROOT_MISMATCH');
  if (!Array.isArray(report.suites) || !Array.isArray(report.errors) || report.errors.length) fail('AIDT_NATIVE_REPORT_ERRORS');
  const started = Date.parse(report.stats?.startTime), prepared = Date.parse(request.startedAt);
  if (!Number.isFinite(started) || !Number.isFinite(prepared) || started < prepared - 1000) fail('AIDT_NATIVE_STALE_REPORT');
  const cases = [], seen = new Set(), bySpec = new Map(declared.map(name => [name, []]));
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      const file = spec.file ?? suite.file;
      const found = declared.find(name => resolve(expectedRoot, String(file)) === resolve(expectedRoot, name));
      if (!found || !Array.isArray(spec.tests) || !spec.tests.length) fail('AIDT_NATIVE_UNDECLARED_OR_EMPTY_SPEC');
      for (const test of spec.tests) {
        const key = `${spec.id ?? `${file}:${spec.line}:${spec.column}:${spec.title}`}:${test.projectId ?? test.projectName}`;
        if (seen.has(key)) fail('AIDT_NATIVE_DUPLICATE_CASE');
        seen.add(key);
        const results = test.results;
        if (!Array.isArray(results) || !results.length) fail('AIDT_NATIVE_CASE_NOT_EXECUTED');
        const attempts = results.map(result => ({ status: result.status, retry: result.retry, duration: result.duration }));
        if (attempts.some(attempt => !['passed', 'failed', 'timedOut', 'interrupted', 'skipped'].includes(attempt.status)
          || !Number.isInteger(attempt.retry) || attempt.retry < 0)) fail('AIDT_NATIVE_ATTEMPT_INVALID');
        const record = { file: found, title: spec.title, project: test.projectName, finalStatus: attempts.at(-1).status, attempts };
        cases.push(record); bySpec.get(found).push(record);
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites) visit(suite);
  const missingSpecs = [...bySpec].filter(([, values]) => values.length === 0).map(([name]) => name);
  const finalFailures = cases.filter(test => test.finalStatus !== 'passed');
  const stats = report.stats;
  if (!stats || !['expected', 'unexpected', 'skipped', 'flaky'].every(key => Number.isInteger(stats[key]) && stats[key] >= 0)
      || stats.expected + stats.unexpected + stats.skipped + stats.flaky !== cases.length) fail('AIDT_NATIVE_STATS_MISMATCH');
  const passed = stepOutcome === 'success' && cases.length > 0 && missingSpecs.length === 0 && finalFailures.length === 0 && stats.unexpected === 0 && stats.skipped === 0;
  return { schemaVersion: 1, status: passed ? 'passed' : 'failed', sourceSha, controlSha, runId, runAttempt,
    scope: 'isolated native browser; real API/PostgreSQL/Redis/MinIO; loopback model/deep-agent/skill-sandbox/ASR/mail; not live Dev or classroom acceptance',
    declaredSpecs: declared, missingSpecs, stepOutcome, actualCases: cases.length, finalPassed: cases.length - finalFailures.length,
    finalFailedOrSkipped: finalFailures.length, flaky: stats.flaky, retriedCases: cases.filter(test => test.attempts.length > 1).length,
    specs: [...bySpec].map(([file, values]) => ({ file, actualCases: values.length, finalPassed: values.filter(test => test.finalStatus === 'passed').length })), cases };
}

export function completeNative(root, env) {
  const output = outputDirectory(root);
  const controlOutput = outputDirectory(root, CONTROL_OUTPUT);
  let verdict;
  try {
    const sourceSha = verifyAidtNativeCheckout(root, env);
    const request = readJson(join(controlOutput, 'request.json'));
    const specs = declaredNativeSpecs(readFileSync(resolve(root, CONFIG), 'utf8'));
    if (JSON.stringify(request.declaredSpecs) !== JSON.stringify(specs)) throw new Error('AIDT_NATIVE_SPEC_INVENTORY_CHANGED');
    const reportPath = join(output, 'results.json');
    const report = readJson(reportPath);
    if (statSync(reportPath).mtimeMs < Date.parse(request.startedAt) - 1000) throw new Error('AIDT_NATIVE_STALE_REPORT');
    verdict = nativeVerdict(report, request, { root, sourceSha, controlSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT, stepOutcome: env.AIDT_NATIVE_TEST_OUTCOME });
  } catch (error) {
    const code = /^AIDT_NATIVE_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'AIDT_NATIVE_EVIDENCE_INVALID';
    verdict = { schemaVersion: 1, status: 'failed', code, expectedSourceSha: /^[a-f0-9]{40}$/.test(env.AIDT_NATIVE_EXPECTED_SOURCE_SHA ?? '') ? env.AIDT_NATIVE_EXPECTED_SOURCE_SHA : null,
      scope: 'isolated native evidence incomplete; not live Dev or classroom acceptance' };
  }
  const file = join(controlOutput, 'verdict.json'); safeFile(file); writeFileSync(file, JSON.stringify(verdict, null, 2));
  return verdict;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = realpathSync(process.cwd()), mode = process.argv[2];
    if (process.argv.length !== 3 || !['prepare', 'verdict'].includes(mode)) throw new Error('AIDT_NATIVE_ARGUMENTS_INVALID');
    const result = mode === 'prepare' ? prepareNative(root, process.env) : completeNative(root, process.env);
    console.log(JSON.stringify(result));
    if (result.status === 'failed') process.exitCode = 1;
  } catch (error) { console.error(/^AIDT_NATIVE_[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'AIDT_NATIVE_EVIDENCE_INVALID'); process.exitCode = 1; }
}
