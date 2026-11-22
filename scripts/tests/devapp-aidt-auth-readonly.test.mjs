import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { ORIGIN, CREDENTIAL_PATH, parseQaCredentials, readQaCredentials, createRequestGuard, projectApiResponse, validLoginBody, routeReadonly } from '../../apps/web/e2e/support/devapp-aidt-auth-readonly.mjs';

const PROBE_ID = 'aidt-readonly-probe-11111111-1111-4111-8111-111111111111';
const DUMMY_SECRET = 'DUMMY_READONLY_PASSWORD_NEVER_LOG';
const loginBody = { email: 'qa@example.invalid', password: DUMMY_SECRET };
const session = { userId: 'DUMMY_OWN_USER', orgs: ['DUMMY_OWN_ORG'],
  sessionToken: 'DUMMY_BEARER_NEVER_LOG', expiresAt: '2999-01-01T00:00:00.000Z' };
function guardReady() { const guard = createRequestGuard(PROBE_ID); guard.armLogin(); guard.confirmLogin('DUMMY_OWN_ORG'); return guard; }
function req(path, method = 'GET', body, resourceType = 'fetch') {
  return { url: `${ORIGIN}${path}`, method, body, resourceType };
}
function fakeRoute(request, status = 200, responseBody = session, headers = {}) {
  const calls = [];
  const response = { status: () => status, body: async () => { calls.push('body'); return Buffer.from(JSON.stringify(responseBody)); },
    dispose: async () => { calls.push('dispose'); }, headers: () => headers };
  return { calls, request: () => ({ url: () => request.url, method: () => request.method,
    resourceType: () => request.resourceType, postDataJSON: () => request.body }),
    fetch: async options => { calls.push(['fetch', options]); return response; },
    fulfill: async () => { calls.push('fulfill'); }, abort: async () => { calls.push('abort'); } };
}

test('pinned same-origin GETs are narrow; real project, roster and other-account reads are blocked', () => {
  const guard = guardReady();
  for (const path of ['/login?next=%2Faidt', '/aidt', '/_next/static/chunks/app.js',
    '/api/identity/me?orgId=DUMMY_OWN_ORG', '/api/aidt/courses?limit=1', `${guard.memberPath}?limit=1`]) {
    assert.equal(guard.decide(req(path)).allow, true);
  }
  for (const path of ['/api/projects', '/api/projects/real-group/member-chat/messages?limit=1',
    '/api/orgs/real-org/members', '/api/identity/me/activity', '/api/aidt/courses?limit=50',
    '/api/aidt/courses/real-course/groups', '/api/chat/threads', '/api/aidt/courses?cursor=private',
    '/api/identity/me?orgId=DUMMY_OTHER_ORG']) {
    assert.equal(guard.decide(req(path)).allow, false);
  }
  assert.equal(guard.fatal(), null);
});

test('wrong origin, scheme, userinfo, ports and external navigation stop before fetch', async () => {
  for (const url of ['https://devapp.boardx.us.evil.invalid/aidt', 'https://evil.invalid/aidt',
    'http://devapp.boardx.us/aidt', 'https://devapp.boardx.us:444/aidt',
    'https://qa:password@devapp.boardx.us/aidt', 'file:///aidt', 'data:text/html,secret']) {
    const guard = guardReady(), route = fakeRoute({ ...req('/aidt'), url });
    await routeReadonly(route, guard, () => {});
    assert.equal(guard.fatal(), 'TARGET_REJECTED');
    assert.deepEqual(route.calls, ['abort']);
  }
});

test('all business/model/permission mutations and unverified refresh endpoints are denied', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
    for (const path of ['/api/copilotkit/agui', '/api/chat/threads', '/api/projects',
      '/api/identity/switch-org', '/api/preferences', '/api/org-invites', '/api/auth/refresh',
      '/api/auth/login/extra', '/api/auth/password-reset/request', '/api/artifacts/a/permissions']) {
      const guard = guardReady(), route = fakeRoute(req(path, method, loginBody));
      await routeReadonly(route, guard, () => {});
      assert.equal(guard.fatal(), 'MUTATION_BLOCKED');
      assert.deepEqual(route.calls, ['abort']);
      assert.equal(guard.summary().businessMutationsAllowed, 0);
      assert.equal(guard.summary().modelRequestsAllowed, 0);
    }
  }
});

test('exact login is armed once, strict email/password only; failure does not retry', async () => {
  const guard = createRequestGuard(PROBE_ID); guard.armLogin();
  let receipt;
  const route = fakeRoute(req('/api/auth/login', 'POST', loginBody));
  await routeReadonly(route, guard, value => { receipt = value; });
  assert.equal(receipt.authenticatedSessionSchema, true);
  assert.equal(route.calls.at(-1), 'fulfill');
  assert.deepEqual(route.calls[0], ['fetch', { maxRedirects: 0, maxRetries: 0, timeout: 15000 }]);
  assert.equal(guard.decide(req('/api/auth/login', 'POST', loginBody)).allow, false);
  assert.equal(guard.summary().loginRequests, 1);
  assert.equal(guard.fatal(), 'LOGIN_REQUEST_REJECTED');
  assert.equal(JSON.stringify(receipt).includes(session.sessionToken), false);
  for (const body of [null, { ...loginBody, role: 'admin' }, { ...loginBody, password: '' }]) {
    const denied = createRequestGuard(PROBE_ID); denied.armLogin();
    assert.equal(denied.decide(req('/api/auth/login', 'POST', body)).allow, false);
  }
  const failed = createRequestGuard(PROBE_ID); failed.armLogin();
  const failure = fakeRoute(req('/api/auth/login', 'POST', loginBody), 401, { reasonCode: 'INVALID_CREDENTIAL', email: loginBody.email });
  await routeReadonly(failure, failed, () => {});
  assert.equal(failed.fatal(), 'AUTHENTICATION_FAILED');
  assert.equal(failed.decide(req('/api/aidt/courses?limit=1')).allow, false);
});

test('redirects are never fulfilled, so auth cannot follow an unguarded target', async () => {
  const guard = createRequestGuard(PROBE_ID); guard.armLogin();
  const route = fakeRoute(req('/api/auth/login', 'POST', loginBody), 307, null, { location: 'https://evil.invalid' });
  await routeReadonly(route, guard, () => {});
  assert.equal(guard.fatal(), 'REDIRECT_BLOCKED');
  assert.equal(route.calls.includes('fulfill'), false);
  assert.equal(route.calls.includes('body'), false);
});

test('random project unexpectedly resolving is discarded before body parsing/rendering', async () => {
  const guard = guardReady(), route = fakeRoute(req(`${guard.memberPath}?limit=1`), 200, { messages: [DUMMY_SECRET] });
  await routeReadonly(route, guard, () => {});
  assert.equal(guard.fatal(), 'UNEXPECTED_MEMBER_PROJECT_RESPONSE');
  assert.equal(route.calls.includes('body'), false);
  assert.equal(route.calls.includes('fulfill'), false);
  assert.deepEqual(route.calls.slice(1), ['dispose', 'abort']);
});

test('API projection exports only closed reason/status/count, never original response fields', () => {
  const body = { items: [{ id: 'DUMMY_ID', name: DUMMY_SECRET, createdAt: '2026-11-17T00:00:00.000Z' }],
    nextCursor: null, email: loginBody.email, token: session.sessionToken };
  const result = projectApiResponse('courses', 200, body);
  assert.deepEqual(result, { httpStatus: 200, reasonCode: null, gate: 'available', itemCount: 1 });
  assert.equal(JSON.stringify(result).includes(DUMMY_SECRET), false);
  assert.equal(JSON.stringify(result).includes(session.sessionToken), false);
  assert.equal(JSON.stringify(result).includes(loginBody.email), false);
  assert.equal(projectApiResponse('courses', 404, { reasonCode: 'AIDT_COURSE_NOT_FOUND' }).gate, 'not-available');
  assert.equal(projectApiResponse('member', 404, { reasonCode: 'MODULE_DISABLED' }).gate, 'disabled');
  assert.equal(projectApiResponse('member', 404, { reasonCode: 'NOT_FOUND' }).gate, 'project-not-found-unverified');
  assert.equal(projectApiResponse('member', 503, { reasonCode: DUMMY_SECRET }).reasonCode, null);
});

test('canonical session shape is checked in memory without emitting actor or token', () => {
  assert.equal(validLoginBody(session), true);
  for (const body of [{ ...session, role: 'admin' }, { ...session, orgs: [] },
    { ...session, sessionToken: '' }, { ...session, expiresAt: '2000-01-01T00:00:00.000Z' }]) {
    assert.equal(validLoginBody(body), false);
  }
});

test('designated QA file is parsed as data: missing fields, malformed lines and duplicates reject', () => {
  const data = `REAL_MODEL_E2E_EMAIL=qa@example.invalid\nREAL_MODEL_E2E_PASSWORD='${DUMMY_SECRET} $(not-a-command)'\n`;
  assert.deepEqual(parseQaCredentials(data), { email: 'qa@example.invalid', password: `${DUMMY_SECRET} $(not-a-command)` });
  for (const text of [`${data}REAL_MODEL_E2E_EMAIL=other@example.invalid\n`,
    `${data}export REAL_MODEL_E2E_PASSWORD='DUMMY_OTHER'\n`,
    'REAL_MODEL_E2E_EMAIL=qa@example.invalid\n', `${data}not an assignment\n`]) {
    assert.throws(() => parseQaCredentials(text), /CREDENTIAL_FILE_INVALID|CREDENTIALS_MISSING/);
  }
});

function credentialIO(text, overrides = {}) {
  const bytes = Buffer.from(text);
  const calls = [];
  const info = { mode: 0o100600, size: bytes.length, dev: 1, ino: 2, mtimeMs: 1,
    isFile: () => true, isSymbolicLink: () => false, ...overrides };
  return { calls, io: {
    lstatSync(path) { calls.push(['lstat', path]); return info; },
    openSync(path, flags) { calls.push(['open', path, flags]); return 3; },
    fstatSync() { return info; },
    readSync(_fd, output, offset, length, position) { const chunk = bytes.subarray(position, position + length); chunk.copy(output, offset); return chunk.length; },
    closeSync(fd) { calls.push(['close', fd]); },
  } };
}

test('credential reader pins fixed path, private regular bounded file, no symlink and no-follow open', () => {
  const text = `REAL_MODEL_E2E_EMAIL=qa@example.invalid\nREAL_MODEL_E2E_PASSWORD=${DUMMY_SECRET}\n`;
  const good = credentialIO(text);
  assert.deepEqual(readQaCredentials(good.io), { email: loginBody.email, password: DUMMY_SECRET });
  assert.deepEqual(good.calls[0], ['lstat', CREDENTIAL_PATH]);
  assert.deepEqual(good.calls[1], ['open', CREDENTIAL_PATH, constants.O_RDONLY | constants.O_NOFOLLOW]);
  assert.deepEqual(good.calls.at(-1), ['close', 3]);
  for (const info of [{ mode: 0o100644 }, { size: 0 }, { size: 16385 },
    { isFile: () => false }, { isSymbolicLink: () => true }]) {
    const denied = credentialIO(text, info);
    assert.throws(() => readQaCredentials(denied.io), /CREDENTIAL_FILE_UNAVAILABLE/);
    assert.equal(denied.calls.some(call => call[0] === 'open'), false);
  }
});

test('file race/read failure never falls back to environment accounts or exposes raw errors', () => {
  const text = `REAL_MODEL_E2E_EMAIL=qa@example.invalid\nREAL_MODEL_E2E_PASSWORD=${DUMMY_SECRET}\n`;
  const raced = credentialIO(text);
  raced.io.fstatSync = () => ({ isFile: () => true, isSymbolicLink: () => false, mode: 0o100600, size: text.length, dev: 1, ino: 999 });
  assert.throws(() => readQaCredentials(raced.io), /CREDENTIAL_FILE_UNAVAILABLE/);
  assert.deepEqual(raced.calls.at(-1), ['close', 3]);
  const old = process.env.REAL_MODEL_E2E_PASSWORD;
  process.env.REAL_MODEL_E2E_PASSWORD = DUMMY_SECRET;
  try {
    assert.throws(() => readQaCredentials({ lstatSync() { throw new Error(DUMMY_SECRET); } }),
      error => error.code === 'CREDENTIAL_FILE_UNAVAILABLE' && !error.message.includes(DUMMY_SECRET));
  } finally {
    if (old === undefined) delete process.env.REAL_MODEL_E2E_PASSWORD; else process.env.REAL_MODEL_E2E_PASSWORD = old;
  }
});

test('manual lane pins the official credential-path contract, data-only preflight and no PDF/permission path', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/real-model-chat-evidence.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n  (?:pull_request|push|schedule|workflow_call):/);
  const input = workflow.split('      aidt_auth_readonly:\n')[1].split('\n      prompt:')[0];
  assert.match(input, /type: boolean/); assert.match(input, /default: false/);
  const legacy = workflow.split('\n  verify:\n')[1].split('\n  readonly-gates:\n')[0];
  const readonly = workflow.split('\n  readonly-gates:\n')[1];
  assert.ok(legacy.startsWith('    if: ${{ !inputs.aidt_auth_readonly }}\n'));
  assert.ok(readonly.startsWith("    if: ${{ github.event_name == 'workflow_dispatch' && inputs.aidt_auth_readonly }}\n"));
  // The registered legacy workflow's entire original job remains byte-identical except the new opt-out guard.
  const originalJob = legacy.replace('    if: ${{ !inputs.aidt_auth_readonly }}\n', '').trimEnd();
  assert.equal(createHash('sha256').update(originalJob).digest('hex'), '481ba727292d02d3257e4a2bc3987514970eb698a69e1454693c889121fee5f7');
  assert.match(workflow, /concurrency:\n  group: real-model-chat-evidence\n  cancel-in-progress: false/);
  for (const flag of [undefined, false, true]) {
    assert.deepEqual({ legacy: !flag, readonly: Boolean(flag) },
      flag === true ? { legacy: false, readonly: true } : { legacy: true, readonly: false });
  }
  assert.doesNotMatch(readonly, /secrets\.|sudo|--with-deps|actions: (?:read|write)|contents: write/);
  assert.match(readonly, /runs-on: \[self-hosted, linux, x64, workspacex\]/);
  assert.match(readonly, /permissions:\n      contents: read/);
  assert.match(readonly, /devapp-aidt-auth-readonly\.mjs --preflight/);
  assert.doesNotMatch(readonly, /real-model-chat-evidence\.sh|e2e:real-model-smoke|storageState|\.screenshot|REAL_MODEL_RUN_ENV_FILE|\.env"/);
  assert.ok(readonly.indexOf('.mjs --preflight') < readonly.indexOf('pnpm install'));
  const script = readFileSync(new URL('../../apps/web/e2e/support/devapp-aidt-auth-readonly.mjs', import.meta.url), 'utf8');
  assert.match(script, /CREDENTIAL_PATH = '\/opt\/workspacex\/real-model-e2e\.env'/);
  assert.doesNotMatch(script, /process\.env\.REAL_MODEL_E2E_(?:EMAIL|PASSWORD|BASE_URL)|writeFile|storageState|\.screenshot\(/);
  assert.equal(ORIGIN, 'https://devapp.boardx.us');
});


const registeredWorkflow = readFileSync(new URL('../../.github/workflows/real-model-chat-evidence.yml', import.meta.url), 'utf8');
const readonlyJob = registeredWorkflow.split('\n  readonly-gates:\n')[1];
function runBlockAfter(marker, workflow = readonlyJob) {
  const after = workflow.split(marker)[1];
  assert.ok(after, `missing step ${marker}`);
  const block = after.split('        run: |\n')[1].split(/\n      - /)[0];
  return block.split('\n').filter(line => !line || line.startsWith('          '))
    .map(line => line.slice(10)).join('\n');
}
const checkoutShell = runBlockAfter('id: private-source\n');
const cleanupShell = runBlockAfter('- name: Remove only this attempt\'s owned private directory\n');

const acceptanceWorkflow = readFileSync(new URL('../../.github/workflows/aidt-devapp-acceptance.yml', import.meta.url), 'utf8');
const acceptanceCleanupShell = runBlockAfter("- name: Remove only this attempt's private directory\n", acceptanceWorkflow);
const acceptancePackageShell = runBlockAfter('- name: Package only audited acceptance tools\n', acceptanceWorkflow);
const acceptanceBundleShell = runBlockAfter('- name: Verify bounded bundle and declared Node version\n', acceptanceWorkflow);

test('the actual acceptance bundle passes the live runner gate with only its checksummed files', () => {
  const base = mkdtempSync(join(tmpdir(), 'aidt-acceptance-bundle-test-'));
  const source = join(base, 'source');
  const output = join(base, 'output');
  const packageOutput = join(base, 'package-output');
  const controlSha = 'ab'.repeat(20);
  const manifestPath = join(source, 'SHA256SUMS');
  const env = { ...process.env, GITHUB_SHA: controlSha, AIDT_ACCEPTANCE_ROOT: base, GITHUB_OUTPUT: output };
  try {
    assert.match(acceptanceWorkflow, /bundle_manifest_sha256: \$\{\{ steps\.bundle\.outputs\.manifest_sha256 \}\}/);
    assert.match(acceptanceWorkflow, /AIDT_BUNDLE_MANIFEST_SHA256: \$\{\{ needs\.controls\.outputs\.bundle_manifest_sha256 \}\}/);
    const build = spawnSync('bash', ['-c', acceptancePackageShell], {
      cwd: new URL('../..', import.meta.url),
      env: { ...env, RUNNER_TEMP: base, GITHUB_OUTPUT: packageOutput }, encoding: 'utf8',
    });
    assert.equal(build.status, 0, build.stderr);
    renameSync(join(base, 'aidt-acceptance-tools'), source);
    const manifest = readFileSync(manifestPath);
    const digest = readFileSync(packageOutput, 'utf8').match(/^manifest_sha256=([a-f0-9]{64})\n$/)?.[1];
    assert.equal(digest, createHash('sha256').update(manifest).digest('hex'));
    const verify = (manifestDigest = digest) => spawnSync('bash', ['-c', acceptanceBundleShell], {
      env: { ...env, AIDT_BUNDLE_MANIFEST_SHA256: manifestDigest }, encoding: 'utf8',
    });

    const positive = verify();
    assert.equal(positive.status, 0, positive.stderr + positive.stdout);
    assert.equal(readFileSync(output, 'utf8'), `node-version=${readFileSync(join(source, '.nvmrc'), 'utf8').trim()}\n`);
    assert.notEqual(verify('').status, 0);

    const extra = join(source, 'unlisted.txt');
    writeFileSync(extra, 'unexpected');
    assert.notEqual(verify().status, 0);
    rmSync(extra);
    symlinkSync('package.json', extra);
    assert.notEqual(verify().status, 0);
    rmSync(extra);

    const packagePath = join(source, 'package.json');
    writeFileSync(packagePath, '{}');
    assert.notEqual(verify().status, 0);
    const changedDigest = createHash('sha256').update('{}').digest('hex');
    writeFileSync(manifestPath, manifest.toString().replace(/^[a-f0-9]{64}  package\.json$/m, `${changedDigest}  package.json`));
    assert.notEqual(verify().status, 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

function isolatedCheckoutFixture() {
  const base = mkdtempSync(join(tmpdir(), 'aidt-private-checkout-test-'));
  const runnerTemp = join(base, '_temp'); const bin = join(base, 'bin');
  mkdirSync(runnerTemp); mkdirSync(bin);
  const root = `${runnerTemp}/../wsx-aidt-auth-123-1`;
  const output = join(base, 'output'); const envFile = join(base, 'environment'); const gitLog = join(base, 'git-argv');
  writeFileSync(output, ''); writeFileSync(envFile, '');
  writeFileSync(join(bin, 'git'), `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
fs.appendFileSync(process.env.DUMMY_GIT_LOG, JSON.stringify(a)+'\\n');
if(a.some(x=>x.includes(process.env.AIDT_FETCH_TOKEN))) process.exit(91);
if(process.env.GIT_CONFIG_GLOBAL!=='/dev/null'||process.env.GIT_CONFIG_SYSTEM!=='/dev/null'||process.env.GIT_CONFIG_NOSYSTEM!=='1'||process.env.GIT_TRACE||process.env.GIT_CONFIG_COUNT) process.exit(92);
if(a.includes('fetch')) {
 const helper=fs.readFileSync(process.env.GIT_ASKPASS,'utf8');
 if(helper.includes(process.env.AIDT_FETCH_TOKEN)||!helper.includes('$AIDT_FETCH_TOKEN')) process.exit(93);
 if(process.env.DUMMY_FAIL_FETCH) process.exit(94);
}
if(a.includes('checkout')) { fs.writeFileSync('.nvmrc','22\\n'); fs.writeFileSync('package.json','{"packageManager":"pnpm@9.15.0"}'); }
if(a.includes('rev-parse')) console.log(process.env.DUMMY_HEAD || process.env.GITHUB_SHA);
`, { mode: 0o700 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: runnerTemp,
    AIDT_AUTH_ROOT: 'DUMMY_INHERITED_ROOT_MUST_NOT_BE_USED', GITHUB_SHA: 'ab'.repeat(20), GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_OUTPUT: output, GITHUB_ENV: envFile, AIDT_FETCH_TOKEN: 'DUMMY_FETCH_CREDENTIAL_NEVER_LOG', DUMMY_GIT_LOG: gitLog,
    GIT_TRACE: '1', GIT_CONFIG_COUNT: '0' };
  return { base, root, output, envFile, gitLog, env, run: (shell, overrides={}) => spawnSync('bash', ['-c', shell], { env: { ...env, ...overrides }, encoding: 'utf8' }),
    close: () => rmSync(base, { recursive: true, force: true }) };
}

test('readonly setup uses unique exact source, validated Node value and isolated pinned pnpm', () => {
  assert.doesNotMatch(readonlyJob, /uses: actions\/checkout@|uses: pnpm\/action-setup@|node-version-file:/);
  const jobEnv = readonlyJob.split('    env:\n')[1].split('    steps:\n')[0];
  // jobs.<id>.env is evaluated before runner allocation: runner/steps/env contexts are forbidden.
  assert.doesNotMatch(jobEnv, /\$\{\{[\s\S]*?\b(?:runner|steps|env|job)\./);
  assert.doesNotMatch(jobEnv, /AIDT_AUTH_ROOT:/);
  assert.match(checkoutShell, /AIDT_AUTH_ROOT="\$RUNNER_TEMP\/\.\.\/wsx-aidt-auth-\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT"/);
  assert.match(checkoutShell, />> "\$GITHUB_ENV"/);
  assert.match(cleanupShell, /AIDT_AUTH_ROOT="\$RUNNER_TEMP\/\.\.\/wsx-aidt-auth-\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT"/);
  assert.match(readonlyJob, /node-version: \$\{\{ steps.private-source.outputs.node-version \}\}/);
  assert.match(readonlyJob, /package-manager-cache: false/);
  assert.match(readonlyJob, /if: \$\{\{ always\(\) && steps.private-source.outputs.owned == 'true' \}\}/);
  assert.match(readonlyJob, /--userconfig="\$AIDT_AUTH_ROOT\/user.npmrc" --globalconfig="\$AIDT_AUTH_ROOT\/global.npmrc"/);
  assert.match(readonlyJob, /--prefix "\$AIDT_AUTH_ROOT\/pnpm" --cache "\$AIDT_AUTH_ROOT\/npm-cache"/);
  const commands = readonlyJob.split('        run: |\n').slice(1);
  assert.equal((readonlyJob.match(/        working-directory: \$\{\{ runner.temp \}\}/g)||[]).length, commands.length);
  assert.equal((readonlyJob.match(/        working-directory:/g)||[]).length, commands.length);
  for (const command of commands) {
    assert.match(command.split(/\n      - /)[0], /cd "\$(?:AIDT_AUTH_ROOT\/source|RUNNER_TEMP)"/);
  }
  assert.equal((readonlyJob.match(/\$\{\{ github.token \}\}/g)||[]).length, 1);
  assert.match(readonlyJob, /env:\n          AIDT_FETCH_TOKEN: \$\{\{ github.token \}\}/);
  assert.equal(createHash('sha256').update(readFileSync(new URL('../../apps/web/e2e/support/devapp-aidt-auth-readonly.mjs', import.meta.url))).digest('hex'), '93f11ad6006a1504389d7885f964e372bbc3c2b71a2c5a6763eac29f87a1e454');
});

test('private checkout fetches only fixed HTTPS exact SHA, keeps token out of files and argv, then cleans its own source', () => {
  const f=isolatedCheckoutFixture();
  try {
    const result=f.run(checkoutShell);
    assert.equal(result.status,0,result.stderr+result.stdout);
    assert.equal(existsSync(join(f.root,'source','.nvmrc')),true);
    assert.equal(existsSync(join(f.root,'askpass')),false);
    assert.match(readFileSync(f.output,'utf8'),/^owned=true\nnode-version=22\n$/);
    assert.equal(readFileSync(f.envFile,'utf8'), `AIDT_AUTH_ROOT=${f.root}\nPLAYWRIGHT_BROWSERS_PATH=${f.root}/browsers\n`);
    const args=readFileSync(f.gitLog,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(args.find(a=>a.includes('init')), ['-c','core.hooksPath=/dev/null','init','-q','--template=','.']);
    assert.deepEqual(args.find(a=>a.includes('fetch')), ['-c','core.hooksPath=/dev/null','-c','credential.helper=','-c','http.followRedirects=false','fetch','-q','--depth=1','https://github.com/boardx/workspacex.git',f.env.GITHUB_SHA]);
    assert.equal(JSON.stringify(args).includes(f.env.AIDT_FETCH_TOKEN),false);
    assert.equal((result.stdout+result.stderr).includes(f.env.AIDT_FETCH_TOKEN),false);
    assert.equal(f.run(cleanupShell).status,0);
    assert.equal(existsSync(f.root),false);
  } finally { f.close(); }
});

test('existing attempt directory is never reused or removed, and cleanup rejects a foreign owner', () => {
  const f=isolatedCheckoutFixture();
  try {
    mkdirSync(f.root); writeFileSync(join(f.root,'.owner'),'DUMMY_FOREIGN_OWNER');
    const result=f.run(checkoutShell);
    assert.notEqual(result.status,0); assert.match(result.stdout,/PRIVATE_SOURCE_ALREADY_EXISTS/);
    assert.equal(readFileSync(f.output,'utf8'),'');
    assert.equal(readFileSync(f.envFile,'utf8'),'');
    assert.equal(existsSync(f.gitLog),false);
    const rejected = f.run(cleanupShell);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /PRIVATE_DIRECTORY_OWNER_MISMATCH/);
    assert.equal(readFileSync(join(f.root,'.owner'),'utf8'),'DUMMY_FOREIGN_OWNER');
  } finally { f.close(); }
});

test('acceptance cleanup rejects a foreign marker and removes its own synthetic directory', () => {
  const f = isolatedCheckoutFixture();
  const root = join(f.base, 'wsx-aidt-acceptance-123-1');
  try {
    mkdirSync(root);
    writeFileSync(join(root, '.owner'), 'DUMMY_FOREIGN_OWNER');
    const rejected = f.run(acceptanceCleanupShell);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /PRIVATE_DIRECTORY_OWNER_MISMATCH/);
    assert.equal(readFileSync(join(root, '.owner'), 'utf8'), 'DUMMY_FOREIGN_OWNER');
    writeFileSync(join(root, '.owner'), '123:1:' + f.env.GITHUB_SHA);
    assert.equal(f.run(acceptanceCleanupShell).status, 0);
    assert.equal(existsSync(root), false);
  } finally { f.close(); }
});

test('fetch failure or wrong source identity stops before setup and removes only the new private directory', () => {
  for (const overrides of [{DUMMY_FAIL_FETCH:'1'}, {DUMMY_HEAD:'cd'.repeat(20)}]) {
    const f=isolatedCheckoutFixture();
    try {
      const result=f.run(checkoutShell,overrides);
      assert.notEqual(result.status,0);
      assert.match(result.stdout,/SOURCE_FETCH_FAILED|SOURCE_IDENTITY_MISMATCH/);
      assert.equal(existsSync(f.root),false);
      assert.doesNotMatch(readFileSync(f.output,'utf8'),/node-version=/);
      assert.equal((result.stdout+result.stderr).includes(f.env.AIDT_FETCH_TOKEN),false);
    } finally { f.close(); }
  }
});


test('runner temp with env-file injection or invalid run identity fails before ownership/export', () => {
  for (const overrides of [{ RUNNER_TEMP: '/tmp/DUMMY_RUNNER\nDUMMY_INJECTED=value' },
    { RUNNER_TEMP: '/tmp/DUMMY_RUNNER\rDUMMY_INJECTED=value' }, { GITHUB_RUN_ID: '../DUMMY_OTHER' }]) {
    const f = isolatedCheckoutFixture();
    try {
      const result = f.run(checkoutShell, overrides);
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(f.output, 'utf8'), '');
      assert.equal(readFileSync(f.envFile, 'utf8'), '');
      assert.equal(existsSync(f.gitLog), false);
      assert.equal(existsSync(f.root), false);
    } finally { f.close(); }
  }
});


test('first-step env export failure cleans owned source and later cleanup does not need exported env', () => {
  const f = isolatedCheckoutFixture();
  try {
    const result = f.run(checkoutShell, { GITHUB_ENV: f.base }); // Directory: file-command export must fail.
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(f.output, 'utf8'), 'owned=true\n');
    assert.equal(existsSync(f.root), false);
    assert.equal(existsSync(f.gitLog), false);
    assert.equal(f.run(cleanupShell).status, 0);
  } finally { f.close(); }
});
