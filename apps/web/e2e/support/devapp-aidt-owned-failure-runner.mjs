/** Fixed owned-run diagnostic runner. Existing reusable consultant only; no model or explicit business mutation. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { consumeReusableQaCredentials } from './devapp-aidt-qa-identity.mjs';
import { validLoginBody } from './devapp-aidt-auth-readonly.mjs';
import { runOwnedFailureReadonly, isSafeOwnedFailureReport, OWNED_FAILURE_SCOPE, OWNED_FAILURE_REPORT_FILE } from './devapp-aidt-owned-failure-readonly.mjs';
const fail = () => { throw new Error('OWNED_FAILURE_RUNNER_REJECTED'); };
export function assertOwnedFailureMode(env) {
  if (env.GITHUB_REPOSITORY !== 'boardx/workspacex' || env.GITHUB_REF !== 'refs/heads/develop' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') || env.AIDT_OWNED_FAILURE_READONLY !== 'true'
    || env.AIDT_LIVE_DEV !== 'true' || env.AIDT_REUSABLE_ORDINARY_QA !== 'true'
    || ['AIDT_AUTH_READONLY','AIDT_PROVISION_ORDINARY_QA','AIDT_AGENT_QA_REVIEW','AIDT_ENTRY_DIAGNOSTIC_ONLY'].some(key => env[key] === 'true')
    || !/^[a-f0-9]{64}$/.test(env.AIDT_REUSABLE_QA_IDENTITY_SHA256 ?? '')) fail();
}
export function checkOwnedFailureRuntime() {
  const script = fileURLToPath(new URL('./image-release-host-permissions.py', import.meta.url));
  const code = 'import importlib.util,json,sys;s=importlib.util.spec_from_file_location("reader",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.aidt_exact_release()))';
  const result = spawnSync('/usr/bin/python3', ['-I','-B','-c',code,script], { encoding: 'utf8', timeout: 30000, maxBuffer: 1048576,
    env: { PATH: '/usr/bin:/bin', TARGET_ENVIRONMENT: 'devapp', AIDT_RELEASE_SOURCE: OWNED_FAILURE_SCOPE.source, AIDT_RELEASE_TAG: OWNED_FAILURE_SCOPE.tag } });
  if (result.status !== 0) fail();
  let proof; try { proof = JSON.parse(result.stdout); } catch { fail(); }
  if (proof?.status !== 'OBSERVED' || !Array.isArray(proof.containers) || !['api','web','agent','sandbox'].every(role => proof.containers.some(item => item.role === role))
    || proof.containers.some(item => item.sourceRevision !== OWNED_FAILURE_SCOPE.source || item.tag !== OWNED_FAILURE_SCOPE.tag)) fail();
  return true;
}
export async function runOwnedFailureReader({ env = process.env, chromiumPort, runtimePort = checkOwnedFailureRuntime } = {}) {
  for (const key of ['DEBUG','PWDEBUG','NODE_DEBUG','NODE_DEBUG_NATIVE','NODE_OPTIONS']) delete env[key];
  let credentials, browser, context, login, loginArmed = false, permit = null, stopped = false;
  const requests = { loginRequests: 0, readsAllowed: 0, readsBlocked: 0, mutationsBlocked: 0 };
  const result = { kind: 'aidt-owned-failure-diagnostic-v1', completed: false, code: 'OWNED_FAILURE_DIAGNOSTIC_UNAVAILABLE',
    runtimeMatched: false, normalRunReadMayMaintainStale: true, diagnostic: null, requests };
  try {
    assertOwnedFailureMode(env);
    const metadata = JSON.parse(readFileSync(new URL('./control-source.json', import.meta.url), 'utf8'));
    if (metadata.controlSource !== env.GITHUB_SHA) fail();
    credentials = consumeReusableQaCredentials(env);
    if (!credentials) fail();
    if (await runtimePort(env) !== true) fail();
    const chromium = chromiumPort ?? (await import('@playwright/test')).chromium;
    const browserEnv = Object.fromEntries(['PATH','HOME','LANG','TZ','PLAYWRIGHT_BROWSERS_PATH'].filter(key => env[key] !== undefined).map(key => [key,env[key]]));
    browser = await chromium.launch({ headless: true, env: browserEnv });
    context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', async route => {
      const request = route.request();
      try {
        const url = new URL(request.url());
        if (stopped || url.origin !== OWNED_FAILURE_SCOPE.origin || url.username || url.password || url.hash) return await route.abort('blockedbyclient');
        if (request.method() === 'POST' && url.pathname === '/api/auth/login' && !url.search) {
          const body = request.postDataJSON();
          if (!loginArmed || login || requests.loginRequests !== 0 || !body || Object.keys(body).sort().join(',') !== 'email,password'
            || body.email !== credentials.email || body.password !== credentials.password) fail();
          requests.loginRequests++;
          const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 });
          const bytes = await response.body();
          if (response.status() !== 200 || bytes.length > 65536) fail();
          const parsed = JSON.parse(bytes.toString('utf8'));
          if (!validLoginBody(parsed)) fail();
          login = parsed;
          await route.fulfill({ response }); return;
        }
        if (request.method() !== 'GET') { requests.mutationsBlocked++; stopped = true; return await route.abort('blockedbyclient'); }
        const read = permit && !permit.claimed && url.href === OWNED_FAILURE_SCOPE.origin + permit.path;
        if (read) { permit.claimed = true; requests.readsAllowed++; return await route.continue(); }
        const ui = url.pathname === '/aidt' && !url.search || url.pathname === '/login' && url.search === '?next=%2Faidt';
        if (ui || url.pathname.startsWith('/_next/static/') || url.pathname === '/favicon.ico') return await route.continue();
        requests.readsBlocked++; await route.abort('blockedbyclient');
      } catch { stopped = true; try { await route.abort('blockedbyclient'); } catch { /* Original request already ended. */ } }
    });
    if (typeof context.routeWebSocket !== 'function') fail();
    await context.routeWebSocket('**/*', socket => { stopped = true; socket.close(); });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('download', () => { stopped = true; }); page.on('popup', () => { stopped = true; });
    await page.goto(OWNED_FAILURE_SCOPE.origin + '/login?next=%2Faidt', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.getByTestId('login-email').fill(credentials.email); await page.getByTestId('login-password').fill(credentials.password);
    loginArmed = true; await page.getByTestId('login-submit').click();
    await page.waitForFunction(() => {
      try { const value = JSON.parse(localStorage.getItem('wsx.session') ?? 'null'); return Boolean(localStorage.getItem('wsx.sessionToken')) && value?.userId
        && (value.version === 1 || value.version === 2 && value.revision && localStorage.getItem('wsx.sessionCommit') === value.revision); } catch { return false; }
    }, undefined, { timeout: 30000 });
    if (stopped || !login || requests.loginRequests !== 1) fail();
    const readSession = () => page.evaluate(() => {
      const value = JSON.parse(localStorage.getItem('wsx.session') ?? 'null');
      return { token: localStorage.getItem('wsx.sessionToken'), actor: value?.userId, org: value?.currentOrgId,
        version: value?.version, revision: value?.revision ?? null, commit: localStorage.getItem('wsx.sessionCommit') };
    });
    const readJson = async (path, { expectedTokenSha256 }) => {
      const thread = '/api/chat/threads/' + encodeURIComponent(OWNED_FAILURE_SCOPE.threadId);
      const threadDetail = thread + '?projectId=' + encodeURIComponent(OWNED_FAILURE_SCOPE.projectId);
      if (stopped || permit || typeof path !== 'string' || !(path.startsWith('/api/identity/me?orgId=') && /^\/api\/identity\/me\?orgId=[A-Za-z0-9_.%-]+$/.test(path)
        || path === threadDetail || path === thread + '/messages?limit=100' || /^\/api\/agent-runs\/[A-Za-z0-9_.:%-]+$/.test(path)) || !/^[a-f0-9]{64}$/.test(expectedTokenSha256 ?? '')) fail();
      permit = { path, claimed: false };
      try {
        const value = await page.evaluate(async ({ path, expected }) => {
          const token = localStorage.getItem('wsx.sessionToken');
          const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2,'0')).join('');
          if (!token || await digest(token) !== expected || localStorage.getItem('wsx.sessionToken') !== token) throw new Error('OWNED_FAILURE_SESSION_CHANGED');
          const response = await fetch(path, { method: 'GET', redirect: 'error', cache: 'no-store', credentials: 'include', headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
          const reader = response.body?.getReader(), decoder = new TextDecoder(); let bytes = 0, text = '';
          if (reader) for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 262144) { await reader.cancel(); throw new Error('OWNED_FAILURE_READ_BOUND'); } text += decoder.decode(part.value,{stream:true}); }
          text += decoder.decode(); const body = JSON.parse(text);
          const current = localStorage.getItem('wsx.sessionToken');
          if (!current || current !== token || await digest(current) !== expected || localStorage.getItem('wsx.sessionToken') !== token) throw new Error('OWNED_FAILURE_SESSION_CHANGED');
          return { status: response.status, body };
        }, { path, expected: expectedTokenSha256 });
        if (!permit.claimed || stopped) fail();
        return value;
      } finally { permit = null; }
    };
    const diagnostic = await runOwnedFailureReadonly({ login, configuredIdentitySha256: env.AIDT_REUSABLE_QA_IDENTITY_SHA256, readSession, readJson });
    if (!isSafeOwnedFailureReport(diagnostic) || stopped) fail();
    if (await runtimePort(env) !== true) fail(); result.runtimeMatched = true; result.diagnostic = diagnostic;
    result.completed = diagnostic.completed; result.code = diagnostic.code;
  } catch { result.completed = false; result.code = 'OWNED_FAILURE_DIAGNOSTIC_UNAVAILABLE'; }
  finally {
    try { await context?.close(); } catch { result.completed = false; result.code = 'OWNED_FAILURE_DIAGNOSTIC_UNAVAILABLE'; }
    try { await browser?.close(); } catch { result.completed = false; result.code = 'OWNED_FAILURE_DIAGNOSTIC_UNAVAILABLE'; }
    credentials = null; login = null; permit = null;
  }
  return result;
}
export async function main() {
  if (process.argv.length === 3 && process.argv[2] === '--preflight') {
    assertOwnedFailureMode(process.env); if (!consumeReusableQaCredentials(process.env)) fail();
    console.log('OWNED_FAILURE_REUSABLE_QA_CONFIGURATION_VALID'); return;
  }
  if (process.argv.length !== 2) fail();
  const result = await runOwnedFailureReader();
  const out = fileURLToPath(new URL('./output/', import.meta.url)); mkdirSync(out, { mode: 0o700 });
  writeFileSync(resolve(out, OWNED_FAILURE_REPORT_FILE), JSON.stringify(result,null,2)+'\n', { flag:'wx', mode:0o600 });
  console.log(JSON.stringify(result)); process.exitCode = result.completed ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch { console.error('OWNED_FAILURE_DIAGNOSTIC_UNAVAILABLE'); process.exitCode = 1; }
}
