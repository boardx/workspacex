// REVIEW DRAFT ONLY. Fixed candidate; targeted succeeds before the original full-stack suite.
// This independent caller never grants legacy lane reuse, merge or deployment authority.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, lstatSync, readlinkSync, realpathSync, mkdirSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const CANDIDATE = Object.freeze({ sha: '3677ab3953da24b8d6ba6b5bba027e8cd1663f59', tree: '67618f078bae10588f867d08986c5ef14e7a3681', parent: '89ce18e3ac07b3a5267d7ecabcb2f459d95996a6' });
export const TARGETS = Object.freeze({ targeted: CANDIDATE.sha, full: CANDIDATE.sha });
export const ENVIRONMENT = Object.freeze({ platform: 'linux', arch: 'x64', runnerOS: 'Linux',
  imageOS: 'ubuntu24', imageVersion: '20260927.320.1', prettyName: 'Ubuntu 24.04.5 LTS',
  node: 'v22.23.3', pnpm: '9.15.0', playwright: '1.62.0', playwrightCore: '1.62.0',
  image: 'mcr.microsoft.com/playwright@sha256:02bbb2155cd7109e3e9c741941097ed1608cf8b6fa44ee2595896da2bdc1f471' });
export const CASES = Object.freeze([
  ['e2e/board-selection-layout.spec.ts', 211], ['e2e/board-selection-layout.spec.ts', 235],
  ['e2e/board-selection-layout.spec.ts', 284], ['e2e/board-selection-layout.spec.ts', 325],
  ['e2e/board-selection-layout.spec.ts', 366], ['e2e/board-thinking-input.spec.ts', 72],
].map(([file, line]) => Object.freeze({ project: 'seeded-github-import', file, line })));
export const TARGETED_ARGV = Object.freeze(['pnpm', 'exec', 'tsx', '.harness/scripts/with-test-isolation.ts', '--',
  'pnpm', '--filter', 'web', 'exec', 'playwright', 'test', '--config', 'playwright.fullstack-smoke.config.ts',
  '--project=seeded-github-import', '--no-deps', '--workers=2', ...CASES.map(c => `${c.file}:${c.line}`)]);
export const FULL_RUNTIME_ARGV = Object.freeze(['.harness/scripts/ci-fullstack-runtime.mjs', 'run', '--', 'pnpm', 'run', 'verify:fullstack-smoke']);
export const FULL_EXPECTED_CASES = 168;
export const FULL_PROJECTS = Object.freeze(['seeded', 'board-collaboration-regressions', 'official-digital-human',
  'realtime-voice', 'official-role-workflow', 'board-image-ingress', 'seeded-github-import']);
export const EXISTING_FIXME = Object.freeze({ project: 'seeded', file: 'e2e/inbox-smoke.spec.ts', line: 67, column: 8,
  describe: '统一收件箱端到端：直接提交、看板拖拽迁移、不做需理由',
  title: '① 直接提交反馈 → 跳转收件箱并自动打开该条详情 drawer' });
// Unreserved config-parsing placeholders only. Never forwarded to a real execution.
export const LIST_ONLY_ENV = Object.freeze({ WORKSPACEX_ISOLATION_SEED: 'candidate-list-only', WORKSPACEX_ISOLATION_ID: 'candidate-list-only',
  WORKSPACEX_DB: 'wsx_candidate_list_only', PGDATABASE: 'wsx_candidate_list_only', PGHOST: '127.0.0.1', PGPORT: '20001',
  REDIS_PORT: '21001', REDIS_PREFIX: 'wsx:candidate-list-only:', MINIO_PORT: '22001', MINIO_CONSOLE_PORT: '23001',
  WORKSPACEX_API_PORT: '24001', WORKSPACEX_WEB_PORT: '25001', SKILL_SANDBOX_PORT: '26001',
  WORKSPACEX_MODEL_PROVIDER_PORT: '27001', WORKSPACEX_DEEP_AGENT_PROVIDER_PORT: '28001', WORKSPACEX_ASR_PROVIDER_PORT: '29001',
  WORKSPACEX_VISION_PROVIDER_PORT: '30001', WORKSPACEX_LOOPBACK_SANDBOX_PORT: '31001', WORKSPACEX_MAIL_PROVIDER_PORT: '19001',
  COMPOSE_PROJECT_NAME: 'wsx-candidate-list-only', WORKSPACEX_DB_CONNECTION_BUDGET: '80' });
export function listCommand(phase) {
  if (!Object.hasOwn(TARGETS, phase)) throw new Error('DIAGNOSTIC_FIXED_PHASE_REQUIRED');
  const command = phase === 'targeted' ? TARGETED_ARGV.slice(5) :
    ['pnpm', '--filter', 'web', 'exec', 'playwright', 'test', '--config', 'playwright.fullstack-smoke.config.ts', '--project=seeded-github-import'];
  return [...command, '--list', '--reporter=json'];
}
export function executionEnvironment(env, sha) {
  if (sha !== CANDIDATE.sha) throw new Error('DIAGNOSTIC_FIXED_SHA_REQUIRED');
  const result = { PATH: env.PATH, HOME: env.HOME, LANG: 'C.UTF-8', CI: 'true', RUNNER_TEMP: env.RUNNER_TEMP,
    GITHUB_SHA: CANDIDATE.sha, GITHUB_RUN_ID: env.GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT: env.GITHUB_RUN_ATTEMPT };
  for (const key of ['FULLSTACK_E2E_SERVER_TIMEOUT_MS', 'WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN']) if (env[key]) result[key] = env[key];
  return result;
}
// Seven original critical bytes are unchanged. Two spec pins bind the approved eight added lines;
// the inbox fixme and original optional authentication probe add two explicit pins.
// All tracked blobs are independently checked.
// Runtime capture also reconstructs every tracked Git blob, rather than trusting these few hashes alone.
export const SOURCE_HASHES = Object.freeze({
  '.harness/scripts/ci-fullstack-runtime.mjs': '8c43ebd836d9bbf0afef3d7a073e4852d8dd3a2ba0279dbd1be8ee2e7714e79c',
  '.harness/scripts/ci-skill-import-auth-probe.mjs': 'f78cfba8e0cc67279a9dc64e467285e72af8eb110e1bb02fad9d257d8147808f',
  '.harness/playwright-runtime-images.json': '961806d909973503fb9c8860ccb00e7e44ba224ba332fe2430de05c4dd470641',
  '.harness/scripts/with-test-isolation.ts': 'be4442e32872afa4b74c34a2a155fb60cc0f662d674d65d1218a51192460e6b4',
  'apps/web/playwright.fullstack-smoke.config.ts': 'a6ce29824f779d9704f13e422c0fde528f7b8e5f08ca0422a755b60101b56dbd',
  'apps/web/e2e/board-selection-layout.spec.ts': '0ceda8d36e57191fc635e8ec5fd4193563c3ce9f485c0928756a6c035da112f3',
  'apps/web/e2e/board-thinking-input.spec.ts': '416db3d1f3df6e0bf87c8f8a43c4540cc9fc42bc53c7763ef195207a11c42c02',
  'package.json': '9b60b05c1acdd99ce7a6ba6e9c920c57e1e954df64def071c2517d4f9aebea56',
  'apps/web/package.json': '1b0bae31555eab21e87255ac28f5562171a06466c7644d24f0e6ab7264156c74',
  'apps/web/e2e/inbox-smoke.spec.ts': '1a15a689fb07b4b4cd79b5e763d31ec2b4602aa8e73d6efbf732ba23c9bc3af9',
  'pnpm-lock.yaml': '34ffcc7514d95ac1ea43aaef23b85c3fa0d33da73375cb64fb6083ffd0fe2c49',
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = reason => { throw new Error(reason); };
export function assertTarget(label, checkoutSha) {
  if (!Object.hasOwn(TARGETS, label) || !/^[a-f0-9]{40}$/.test(CANDIDATE.sha) || checkoutSha !== TARGETS[label]) fail('DIAGNOSTIC_FIXED_SHA_REQUIRED');
}
export function assertEnvironment(facts, installed = true) {
  for (const [key, expected] of Object.entries(ENVIRONMENT)) {
    if (!installed && ['playwright', 'playwrightCore', 'image'].includes(key)) continue;
    if (facts[key] !== expected) fail(`DIAGNOSTIC_ENVIRONMENT_MISMATCH:${key}`);
  }
}
export function recordAndAssertEnvironment(receipt, facts, installed = true) {
  // Record only the allowlisted observations before asserting, including failed/missing values.
  receipt.environment = Object.fromEntries(Object.keys(ENVIRONMENT).filter(key => Object.hasOwn(facts, key)).map(key => [key, facts[key]]));
  receipt.environmentMismatches = Object.entries(ENVIRONMENT)
    .filter(([key, expected]) => (installed || !['playwright', 'playwrightCore', 'image'].includes(key)) && facts[key] !== expected)
    .map(([key, expected]) => ({ field: key, expected, actual: facts[key] ?? null }));
  assertEnvironment(receipt.environment, installed);
}
export function assertSourceHashes(actual) {
  for (const [file, expected] of Object.entries(SOURCE_HASHES)) {
    if (actual[file] !== expected) fail('DIAGNOSTIC_TARGET_SOURCE_CHANGED');
  }
}
export function targetedRuntimeArgs(runtimeArgs, inputs, list = false) {
  const args = runtimeArgs(inputs);
  const suffix = 'exec pnpm run verify:fullstack-smoke';
  if (!args.at(-1)?.endsWith(suffix) || args.at(-2) !== '-euc' || args.at(-3) !== 'bash') fail('DIAGNOSTIC_RUNTIME_SUFFIX_CHANGED');
  // No rewriting of assertRuntimeCommand, package scripts, config, selectors or test source.
  // Every preceding production Docker argument and bootstrap command stays byte-for-byte identical.
  const argv = [...TARGETED_ARGV, ...(list ? ['--list', '--reporter=json'] : [])];
  if (!argv.every(arg => /^[A-Za-z0-9_./:=+-]+$/.test(arg))) fail('DIAGNOSTIC_CANONICAL_ARGV_INVALID');
  return [...args.slice(0, -1), args.at(-1).slice(0, -suffix.length) + 'exec ' + argv.join(' ')];
}
export function reportRows(report, root) {
  if (!report || !Array.isArray(report.suites) || !Array.isArray(report.errors) || report.errors.length ||
      report.config?.rootDir !== resolve(root, 'apps/web/e2e')) fail('DIAGNOSTIC_LIST_REPORT_INVALID');
  const found = [];
  const walk = (suites, parents = []) => {
    for (const suite of suites) {
      if (!suite || !Array.isArray(suite.specs ?? []) || !Array.isArray(suite.suites ?? [])) fail('DIAGNOSTIC_LIST_REPORT_INVALID');
      const titles = [...parents, suite.title ?? ''];
      for (const spec of suite.specs ?? []) {
        if (!spec || typeof spec.file !== 'string' || !Number.isSafeInteger(spec.line) || !Array.isArray(spec.tests)) fail('DIAGNOSTIC_LIST_REPORT_INVALID');
        const file = resolve(report.config.rootDir, spec.file);
        for (const test of spec.tests) found.push({ project: test.projectName, file, line: spec.line, column: spec.column ?? 0, titlePath: [...titles, spec.title ?? ''], test });
      }
      walk(suite.suites ?? [], titles);
    }
  };
  walk(report.suites);
  return found;
}
export function listLocations(report, root) {
  const found = reportRows(report, root);
  const expected = CASES.map(c => `${c.project}|${resolve(root, 'apps/web', c.file)}|${c.line}`).sort();
  const actual = found.map(c => `${c.project}|${c.file}|${c.line}`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('DIAGNOSTIC_EXACT_SIX_LOCATIONS_REQUIRED');
  return found;
}
const rowKey = row => JSON.stringify([row.project, row.file, row.line, row.column, row.titlePath]);
const singleCleanPass = test => test.expectedStatus === 'passed' && test.status === 'expected' &&
  test.results.length === 1 && test.results[0].status === 'passed' && test.results[0].retry === 0;
export function isExistingFixme(row, root) {
  return row.project === EXISTING_FIXME.project && row.file === resolve(root, 'apps/web', EXISTING_FIXME.file) &&
    row.line === EXISTING_FIXME.line && row.column === EXISTING_FIXME.column &&
    row.titlePath.at(-1) === EXISTING_FIXME.title && row.titlePath.includes(EXISTING_FIXME.describe);
}
export function fullListLocations(report, root) {
  const rows = reportRows(report, root);
  if (rows.length !== FULL_EXPECTED_CASES || new Set(rows.map(rowKey)).size !== FULL_EXPECTED_CASES ||
      JSON.stringify([...new Set(rows.map(row => row.project))].sort()) !== JSON.stringify([...FULL_PROJECTS].sort())) fail('DIAGNOSTIC_FULL_SCOPE_REQUIRED');
  const targetKeys = CASES.map(c => `${c.project}|${resolve(root, 'apps/web', c.file)}|${c.line}`).sort();
  const selected = rows.map(c => `${c.project}|${c.file}|${c.line}`).filter(key => targetKeys.includes(key)).sort();
  if (JSON.stringify(selected) !== JSON.stringify(targetKeys) || rows.filter(row => isExistingFixme(row, root)).length !== 1) fail('DIAGNOSTIC_FULL_TARGET_OR_FIXME_SCOPE_REQUIRED');
  return rows;
}
export function assertFullExecution(report, preflight, root, exitCode) {
  const rows = fullListLocations(report, root), expected = fullListLocations(preflight, root);
  if (JSON.stringify(rows.map(rowKey).sort()) !== JSON.stringify(expected.map(rowKey).sort())) fail('DIAGNOSTIC_FULL_EXECUTION_SCOPE_CHANGED');
  for (const row of rows) {
    if (isExistingFixme(row, root)) {
      if (row.test.status !== 'skipped' || row.test.expectedStatus !== 'skipped' ||
          !row.test.annotations?.some(annotation => annotation.type === 'fixme') ||
          !Array.isArray(row.test.results) || row.test.results.some(result => result.status !== 'skipped')) fail('DIAGNOSTIC_ORIGINAL_FIXME_CHANGED');
    } else if (!Array.isArray(row.test.results) || !row.test.results.length || row.test.status === 'skipped' ||
        row.test.results.some(result => !['passed', 'failed', 'timedOut', 'interrupted'].includes(result.status))) fail('DIAGNOSTIC_ADDITIONAL_SKIP_OR_UNEXECUTED_DEPENDENCY');
  }
  if (exitCode === 0 && (report.stats?.expected !== 167 || report.stats?.skipped !== 1 || report.stats?.unexpected !== 0 || report.stats?.flaky !== 0 ||
      rows.some(row => !isExistingFixme(row, root) && !singleCleanPass(row.test)))) fail('DIAGNOSTIC_FULL_PASS_REQUIRED');
  return { accountedCases: rows.length, executedCases: 167, existingFixmeCases: 1, successful: exitCode === 0 };
}
export function extractListReport(stdout) {
  // Production bootstrap and isolation timing surround the JSON list. Read a bounded,
  // balanced JSON object, and reject multiple reports or any list error. Never evaluate it.
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 32 * 1024 * 1024) fail('DIAGNOSTIC_LIST_OUTPUT_LIMIT');
  const reports = [];
  for (let at = 0; at < stdout.length; at++) {
    if (stdout[at] !== '{') continue;
    let depth = 0, quoted = false, escaped = false, end = at;
    for (; end < stdout.length; end++) {
      const char = stdout[end];
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
      else if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) break;
    }
    if (depth !== 0) continue;
    try { const value = JSON.parse(stdout.slice(at, end + 1)); if (value?.config && Array.isArray(value.suites)) reports.push(value); } catch {}
    at = end;
  }
  if (reports.length !== 1) fail('DIAGNOSTIC_UNIQUE_LIST_REPORT_REQUIRED');
  return reports[0];
}
export function assertExecutedReport(report, root, exitCode) {
  const locations = listLocations(report, root);
  if (locations.some(({ test }) => !Array.isArray(test.results) || !test.results.length || test.status === 'skipped' ||
      test.results.some(r => !['passed', 'failed', 'timedOut', 'interrupted'].includes(r.status)))) fail('DIAGNOSTIC_UNEXECUTED_CASE');
  if (exitCode === 0 && (report.stats?.expected !== 6 || report.stats?.skipped !== 0 || report.stats?.unexpected !== 0 || report.stats?.flaky !== 0 ||
      locations.some(({ test }) => !singleCleanPass(test)))) fail('DIAGNOSTIC_TARGETED_PASS_REQUIRED');
  return { executedCases: locations.length, successful: exitCode === 0 };
}
function hostEnv(env) { return { PATH: env.PATH, HOME: env.HOME, LANG: 'C.UTF-8' }; }
function command(root, env, executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, env: hostEnv(env), encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) fail('DIAGNOSTIC_HOST_COMMAND_FAILED');
  return result.stdout?.trim() ?? '';
}
function sourceManifest(root, env, label) {
  const sha = command(root, env, 'git', ['rev-parse', 'HEAD']); assertTarget(label, sha);
  const tree = command(root, env, 'git', ['rev-parse', 'HEAD^{tree}']);
  if (tree !== CANDIDATE.tree || command(root, env, 'git', ['show', '-s', '--format=%P', 'HEAD']) !== CANDIDATE.parent) fail('DIAGNOSTIC_FIXED_TREE_PARENT_REQUIRED');
  command(root, env, 'git', ['diff', '--quiet', 'HEAD', '--']);
  const entries = command(root, env, 'git', ['ls-tree', '-rz', 'HEAD']).split('\0').filter(Boolean).map(row => {
    const match = /^(100644|100755|120000) blob ([a-f0-9]{40})\t(.+)$/.exec(row);
    if (!match || match[3].startsWith('/') || match[3].split('/').some(s => !s || s === '.' || s === '..')) fail('DIAGNOSTIC_TRACKED_TREE_INVALID');
    const [mode, oid, path] = match.slice(1); const file = resolve(root, path); const stat = lstatSync(file);
    const bytes = mode === '120000' && stat.isSymbolicLink() ? Buffer.from(readlinkSync(file)) :
      stat.isFile() && !stat.isSymbolicLink() && ((stat.mode & 0o111) !== 0) === (mode === '100755') ? readFileSync(file) : fail('DIAGNOSTIC_TRACKED_FILE_INVALID');
    if (createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== oid) fail('DIAGNOSTIC_TRACKED_BLOB_CHANGED');
    return { path, mode, oid, sha256: hash(bytes) };
  });
  assertSourceHashes(Object.fromEntries(entries.map(e => [e.path, e.sha256])));
  return { sha, tree, trackedFiles: entries.length, fingerprint: hash(JSON.stringify(entries)), entries };
}
function prepareTools(root, env, runtime, image) {
  command(root, env, 'docker', ['pull', '--platform', 'linux/amd64', image], { stdio: 'inherit' });
  const which = name => realpathSync(command(root, env, 'which', [name]));
  const docker = which('docker');
  const plugins = JSON.parse(command(root, env, docker, ['info', '--format', '{{json .ClientInfo.Plugins}}']));
  const compose = realpathSync(plugins.find(p => p.Name === 'compose')?.Path ?? '');
  const pnpm = runtime.pnpmPackageRoot(which('pnpm'));
  const home = resolve(env.RUNNER_TEMP, 'wsx-smoke-runtime-home'); const tools = resolve(env.RUNNER_TEMP, 'wsx-smoke-runtime-tools');
  mkdirSync(home, { recursive: true, mode: 0o700 }); mkdirSync(resolve(tools, 'bin'), { recursive: true, mode: 0o700 });
  mkdirSync(resolve(tools, 'pnpm'), { recursive: true, mode: 0o700 }); mkdirSync(resolve(home, '.docker/cli-plugins'), { recursive: true, mode: 0o700 });
  writeFileSync(resolve(home, '.docker/cli-plugins/docker-compose'), '', { mode: 0o600 });
  writeFileSync(resolve(tools, 'bin/pnpm'), '#!/bin/sh\nexec node /wsx-ci-tools/pnpm/bin/pnpm.cjs "$@"\n', { mode: 0o700 }); chmodSync(resolve(tools, 'bin/pnpm'), 0o700);
  writeFileSync(resolve(tools, 'bin/apt-get'), '#!/bin/sh\nexit 78\n', { mode: 0o700 });
  for (const path of ['bin/node', 'bin/docker', 'bin/unzip']) writeFileSync(resolve(tools, path), '', { mode: 0o600 });
  return { root, home, tools, uid: process.getuid(), gid: process.getgid(), image, node: realpathSync(process.execPath),
    pnpm, docker, compose, unzip: which('unzip'), socketGid: statSync('/var/run/docker.sock').gid,
    env: { CI: 'true', GITHUB_SHA: TARGETS[env.DIAGNOSTIC_CASE_LABEL], GITHUB_RUN_ID: env.GITHUB_RUN_ID,
      GITHUB_RUN_ATTEMPT: env.GITHUB_RUN_ATTEMPT, FULLSTACK_E2E_SERVER_TIMEOUT_MS: env.FULLSTACK_E2E_SERVER_TIMEOUT_MS,
      WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN: env.WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN } };
}
async function executeChild(executable, args, root, env) {
  const child = spawn(executable, args, { cwd: root, stdio: 'inherit', env });
  const term = () => child.kill('SIGTERM'); const interrupt = () => child.kill('SIGINT');
  process.once('SIGTERM', term); process.once('SIGINT', interrupt);
  try { return await new Promise((done, reject) => { child.once('error', () => reject(new Error('DIAGNOSTIC_CHILD_EXEC_FAILED'))); child.once('close', (code, signal) => done(code ?? (signal ? 143 : 1))); }); }
  finally { process.removeListener('SIGTERM', term); process.removeListener('SIGINT', interrupt); }
}
async function main(mode, env) {
  if (!['capture', 'verify-source', 'run'].includes(mode) || process.argv.length !== 3) fail('DIAGNOSTIC_FIXED_CALLER_CONTRACT');
  if (!Object.hasOwn(TARGETS, env.DIAGNOSTIC_CASE_LABEL) || env.GITHUB_REPOSITORY !== 'boardx/workspacex' ||
      env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || !env.GITHUB_REF?.startsWith('refs/heads/diagnostic/') ||
      !env.GITHUB_WORKSPACE || !env.RUNNER_TEMP) fail('DIAGNOSTIC_DISPATCH_BRANCH_REQUIRED');
  const root = realpathSync(env.GITHUB_WORKSPACE);
  const output = resolve(env.RUNNER_TEMP, `wsx-board-candidate-${env.DIAGNOSTIC_CASE_LABEL}`);
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const receipt = { schemaVersion: 1, diagnosticOnly: true, fullValidation: false, reusableLaneEvidence: false,
    label: env.DIAGNOSTIC_CASE_LABEL, targetSha: TARGETS[env.DIAGNOSTIC_CASE_LABEL], controllerSha: env.GITHUB_SHA,
    controllerFileSha256: hash(readFileSync(new URL(import.meta.url))), workspace: root,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, phase: env.DIAGNOSTIC_CASE_LABEL,
    argv: env.DIAGNOSTIC_CASE_LABEL === 'targeted' ? TARGETED_ARGV : FULL_RUNTIME_ARGV,
    expectedCases: env.DIAGNOSTIC_CASE_LABEL === 'targeted' ? 6 : FULL_EXPECTED_CASES,
    dependencyState: env.DIAGNOSTIC_CASE_LABEL === 'targeted' ? 'fresh isolated seeded stack; --no-deps excludes full dependencies' : 'original full-stack command and complete project dependency closure on a fresh isolated stack',
    expectedEnvironment: ENVIRONMENT, executed: false };
  try {
    const os = Object.fromEntries(readFileSync('/etc/os-release', 'utf8').split('\n').filter(s => s.includes('=')).map(s => { const at = s.indexOf('='); return [s.slice(0, at), s.slice(at + 1).replace(/^"|"$/g, '')]; }));
    const host = { platform: process.platform, arch: process.arch, runnerOS: env.RUNNER_OS,
      imageOS: env.ImageOS, imageVersion: env.ImageVersion, prettyName: os.PRETTY_NAME, node: process.version };
    receipt.environment = host;
    host.pnpm = command(root, env, 'pnpm', ['--version']);
    // Capture reports only observed host fields. Installed package/image facts are measured in run.
    recordAndAssertEnvironment(receipt, host, false);
    const before = sourceManifest(root, env, env.DIAGNOSTIC_CASE_LABEL);
    if (mode === 'capture') {
      writeFileSync(resolve(output, 'source-before-install.json'), JSON.stringify(before, null, 2), { flag: 'wx', mode: 0o600 });
      receipt.source = { sha: before.sha, tree: before.tree, fingerprint: before.fingerprint, trackedFiles: before.trackedFiles };
      return 0;
    }
    const captured = JSON.parse(readFileSync(resolve(output, 'source-before-install.json'), 'utf8'));
    if (captured.sha !== before.sha || captured.tree !== before.tree || captured.fingerprint !== before.fingerprint) fail('DIAGNOSTIC_INSTALL_CHANGED_TRACKED_SOURCE');
    if (mode === 'verify-source') {
      receipt.source = { sha: before.sha, tree: before.tree, fingerprint: before.fingerprint, trackedFiles: before.trackedFiles };
      receipt.completeInstalledSourceVerified = true;
      return 0;
    }
    const req = createRequire(resolve(root, 'apps/web/package.json'));
    host.playwright = req('@playwright/test/package.json').version;
    receipt.environment.playwright = host.playwright;
    host.playwrightCore = req('playwright-core/package.json').version;
    receipt.environment.playwrightCore = host.playwrightCore;
    const runtime = await import(pathToFileURL(resolve(root, '.harness/scripts/ci-fullstack-runtime.mjs')).href);
    host.image = runtime.sealedImage(host.playwright, JSON.parse(readFileSync(resolve(root, '.harness/playwright-runtime-images.json'), 'utf8')));
    recordAndAssertEnvironment(receipt, host);
    const phase = env.DIAGNOSTIC_CASE_LABEL;
    // Configuration-only discovery: --list never starts webServer/tests. These fixed
    // placeholders satisfy config parsing only, reserve no ports and never enter execution.
    const list = spawnSync('pnpm', listCommand(phase).slice(1), {
      cwd: root, env: { ...hostEnv(env), CI: 'true', ...LIST_ONLY_ENV }, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    writeFileSync(resolve(output, 'list.stdout.log'), list.stdout ?? '', { mode: 0o600 }); writeFileSync(resolve(output, 'list.stderr.log'), list.stderr ?? '', { mode: 0o600 });
    if (list.error || list.status !== 0) fail('DIAGNOSTIC_LIST_PREFLIGHT_FAILED');
    const report = extractListReport(list.stdout);
    if (phase === 'targeted') listLocations(report, root); else fullListLocations(report, root);
    writeFileSync(resolve(output, 'list-report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    if (sourceManifest(root, env, phase).fingerprint !== before.fingerprint) fail('DIAGNOSTIC_LIST_CHANGED_TRACKED_SOURCE');
    receipt.preflightScopeVerified = true;
    receipt.listOnlyEnvironment = { values: LIST_ONLY_ENV, reserved: false, usedForExecution: false, dockerOrTestExecution: false };
    let status;
    try {
      if (phase === 'targeted') {
        const inputs = prepareTools(root, env, runtime, host.image);
        status = await executeChild(inputs.docker, targetedRuntimeArgs(runtime.runtimeArgs, inputs), root, { PATH: env.PATH, HOME: inputs.home, LANG: 'C.UTF-8', ...inputs.env });
      } else {
        // Use the untouched production CLI contract; no suffix rewrite or no-deps override in full mode.
        status = await executeChild(process.execPath, FULL_RUNTIME_ARGV, root, executionEnvironment(env, CANDIDATE.sha));
      }
      receipt.executed = true; receipt.exitCode = status;
      const execution = JSON.parse(readFileSync(resolve(root, 'apps/web/test-results/fullstack-smoke.json'), 'utf8'));
      receipt.observedStats = execution.stats;
      receipt.result = phase === 'targeted' ? assertExecutedReport(execution, root, status) : assertFullExecution(execution, report, root, status);
    } finally {
      const after = sourceManifest(root, env, env.DIAGNOSTIC_CASE_LABEL);
      writeFileSync(resolve(output, 'source-after-execution.json'), JSON.stringify(after, null, 2), { mode: 0o600 });
      if (after.fingerprint !== before.fingerprint) fail('DIAGNOSTIC_EXECUTION_CHANGED_TRACKED_SOURCE');
      receipt.sourcePreserved = true;
    }
    return status;
  } catch (error) { receipt.blocker = error.message; throw error; }
  finally { writeFileSync(resolve(output, `${mode}-receipt.json`), JSON.stringify(receipt, null, 2), { mode: 0o600 }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2], process.env).then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
