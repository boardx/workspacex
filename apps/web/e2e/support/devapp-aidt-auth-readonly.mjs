/** Existing QA-account gate check only; no project, permission, message or model writes. */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { parseEnv } from 'node:util';

export const ORIGIN = 'https://devapp.boardx.us';
// Same designated existing QA credential source as the official real-model preflight;
// parse as data, never source shell code, follow another path or fall back to exported accounts.
export const CREDENTIAL_PATH = '/opt/workspacex/real-model-e2e.env';
const CREDENTIAL_LIMIT = 16384;
const LOGIN = '/api/auth/login';
const COURSES = '/api/aidt/courses';
const knownReasons = new Set(['INVALID_CREDENTIAL', 'ACCOUNT_LOCKED', 'EMAIL_NOT_VERIFIED',
  'AUTH_SERVICE_UNAVAILABLE', 'AIDT_COURSE_NOT_FOUND', 'AIDT_COURSE_FORBIDDEN',
  'AIDT_COURSE_INVALID', 'AIDT_COURSE_UNAVAILABLE', 'MODULE_DISABLED', 'NOT_FOUND',
  'INVALID_INPUT', 'DEPENDENCY_UNAVAILABLE']);

export class ProbeFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function parseQaCredentials(text) {
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/.exec(line.trimStart());
    if (!match || keys.has(match[1])) throw new ProbeFailure('CREDENTIAL_FILE_INVALID');
    keys.add(match[1]);
  }
  let values;
  try { values = parseEnv(text); } catch { throw new ProbeFailure('CREDENTIAL_FILE_INVALID'); }
  const email = values.REAL_MODEL_E2E_EMAIL, password = values.REAL_MODEL_E2E_PASSWORD;
  if (!email || !password) throw new ProbeFailure('CREDENTIALS_MISSING');
  return { email, password };
}

export function readQaCredentials(io = { lstatSync, openSync, fstatSync, readSync, closeSync }) {
  let fd;
  try {
    const before = io.lstatSync(CREDENTIAL_PATH);
    const privateFile = info => info.isFile() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o600
      && info.size > 0 && info.size <= CREDENTIAL_LIMIT;
    if (!privateFile(before)) throw new ProbeFailure('CREDENTIAL_FILE_UNAVAILABLE');
    fd = io.openSync(CREDENTIAL_PATH, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = io.fstatSync(fd);
    if (!privateFile(opened) || opened.dev !== before.dev || opened.ino !== before.ino) throw new ProbeFailure('CREDENTIAL_FILE_UNAVAILABLE');
    const bytes = Buffer.alloc(CREDENTIAL_LIMIT + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = io.readSync(fd, bytes, length, bytes.length - length, length);
      if (!count) break;
      length += count;
    }
    const after = io.fstatSync(fd);
    if (length !== opened.size || length > CREDENTIAL_LIMIT || !privateFile(after)
        || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new ProbeFailure('CREDENTIAL_FILE_UNAVAILABLE');
    return parseQaCredentials(bytes.subarray(0, length).toString('utf8'));
  } catch (error) {
    throw error instanceof ProbeFailure ? error : new ProbeFailure('CREDENTIAL_FILE_UNAVAILABLE');
  } finally { if (fd !== undefined) io.closeSync(fd); }
}

export function createRequestGuard(probeId = `aidt-readonly-probe-${randomUUID()}`) {
  if (!/^aidt-readonly-probe-[a-f0-9-]{36}$/.test(probeId)) throw new ProbeFailure('INVALID_PROBE_ID');
  const memberPath = `/api/projects/${probeId}/member-chat/messages`;
  let armed = false, authenticated = false, currentOrg = null, fatal = null, signal;
  const failure = new Promise(resolve => { signal = resolve; });
  const counts = { loginRequests: 0, readsAllowed: 0, readsBlocked: 0, mutationsBlocked: 0 };
  function fail(code) { if (!fatal) { fatal = code; signal(code); } }
  function decide({ url, method, resourceType, body }) {
    if (fatal) return { allow: false, kind: 'stopped' };
    let target;
    try { target = new URL(url); } catch { fail('TARGET_REJECTED'); return { allow: false, kind: 'target' }; }
    if (target.origin !== ORIGIN || target.username || target.password || target.hash) {
      fail('TARGET_REJECTED'); return { allow: false, kind: 'target' };
    }
    if (method === 'POST' && target.pathname === LOGIN && !target.search) {
      const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).sort() : [];
      if (!armed || authenticated || counts.loginRequests !== 0 || keys.join(',') !== 'email,password'
          || typeof body.email !== 'string' || !body.email || typeof body.password !== 'string' || !body.password) {
        fail('LOGIN_REQUEST_REJECTED'); return { allow: false, kind: 'login' };
      }
      counts.loginRequests++;
      return { allow: true, kind: 'login' };
    }
    if (method !== 'GET') {
      counts.mutationsBlocked++; fail('MUTATION_BLOCKED'); return { allow: false, kind: 'mutation' };
    }
    const path = target.pathname;
    const ui = path === '/aidt' || (path === '/login'
      && [...target.searchParams.keys()].every(key => key === 'next')
      && (!target.searchParams.has('next') || target.searchParams.get('next') === '/aidt'));
    const assets = path.startsWith('/_next/static/') || path === '/favicon.ico';
    // Login hydration reads only this account's identity; no org switch or refresh mutation exists here.
    const identity = authenticated && path === '/api/identity/me'
      && target.searchParams.get('orgId') === currentOrg
      && [...target.searchParams.keys()].every(key => key === 'orgId');
    const courses = authenticated && path === COURSES
      && [...target.searchParams.keys()].every(key => key === 'limit')
      && (!target.searchParams.has('limit') || ['1', '20'].includes(target.searchParams.get('limit')));
    const member = authenticated && path === memberPath && target.search === '?limit=1';
    if (ui || assets || identity || courses || member) {
      counts.readsAllowed++; return { allow: true, kind: 'read' };
    }
    counts.readsBlocked++;
    if (resourceType === 'document') fail('NAVIGATION_BLOCKED');
    return { allow: false, kind: 'out-of-scope-read' };
  }
  return { memberPath, failure, fail, decide, armLogin: () => { armed = true; },
    confirmLogin: orgId => { authenticated = true; currentOrg = orgId; }, fatal: () => fatal,
    summary: () => ({ ...counts, businessMutationsAllowed: 0, modelRequestsAllowed: 0 }) };
}

export function projectApiResponse(kind, status, body) {
  const reasonCode = knownReasons.has(body?.reasonCode) ? body.reasonCode : null;
  const result = { httpStatus: status, reasonCode, gate: 'unknown' };
  if (kind === 'courses') {
    const valid = status === 200 && body && Array.isArray(body.items) && body.items.length <= 1
      && (body.nextCursor === null || typeof body.nextCursor === 'string')
      && body.items.every(item => item && typeof item.id === 'string' && typeof item.name === 'string'
        && typeof item.createdAt === 'string');
    if (valid) return { ...result, gate: 'available', itemCount: body.items.length };
    // This error also covers absent org membership: never rename it MODULE_DISABLED.
    if (status === 404 && reasonCode === 'AIDT_COURSE_NOT_FOUND') result.gate = 'not-available';
  } else if (kind === 'member') {
    if (status === 404 && reasonCode === 'MODULE_DISABLED') result.gate = 'disabled';
    if (status === 404 && reasonCode === 'NOT_FOUND') result.gate = 'project-not-found-unverified';
  }
  return result;
}

export function validLoginBody(body, now = Date.now()) {
  return Boolean(body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).sort().join(',') === 'expiresAt,orgs,sessionToken,userId'
    && typeof body.sessionToken === 'string' && body.sessionToken.length > 0
    && typeof body.userId === 'string' && body.userId.length > 0
    && Array.isArray(body.orgs) && body.orgs.length > 0 && body.orgs.every(org => typeof org === 'string' && org.length > 0)
    && typeof body.expiresAt === 'string' && Date.parse(body.expiresAt) > now);
}

export async function routeReadonly(route, guard, onLogin) {
  const request = route.request();
  try {
    let body;
    if (request.method() === 'POST' && new URL(request.url()).pathname === LOGIN) {
      try { body = request.postDataJSON(); } catch { /* The guard rejects malformed login bodies. */ }
    }
    const decision = guard.decide({ url: request.url(), method: request.method(), resourceType: request.resourceType(), body });
    if (!decision.allow) return await route.abort('blockedbyclient');
    // No automatic redirect or transport retry can carry credentials beyond the pinned origin.
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 });
    if (response.status() >= 300 && response.status() < 400) {
      guard.fail('REDIRECT_BLOCKED'); return await route.abort('blockedbyclient');
    }
    if (new URL(request.url()).pathname === guard.memberPath && response.status() === 200) {
      // Headers arrived for an unexpectedly resolving ID: discard, never parse/render/export its messages.
      guard.fail('UNEXPECTED_MEMBER_PROJECT_RESPONSE');
      await response.dispose(); return await route.abort('blockedbyclient');
    }
    if (decision.kind === 'login') {
      let parsed;
      const bytes = await response.body();
      if (bytes.length <= 65536) { try { parsed = JSON.parse(bytes.toString('utf8')); } catch { /* No raw body retained. */ } }
      const valid = response.status() === 200 && validLoginBody(parsed);
      onLogin({ httpStatus: response.status(), reasonCode: knownReasons.has(parsed?.reasonCode) ? parsed.reasonCode : null, authenticatedSessionSchema: valid });
      if (!valid) { guard.fail('AUTHENTICATION_FAILED'); return await route.abort('blockedbyclient'); }
      guard.confirmLogin(parsed.orgs[0]);
    }
    if (new URL(request.url()).pathname === '/api/identity/me' && [401, 403].includes(response.status())) {
      guard.fail('AUTHENTICATION_FAILED'); return await route.abort('blockedbyclient');
    }
    await route.fulfill({ response });
  } catch { guard.fail('REQUEST_FAILED'); try { await route.abort('blockedbyclient'); } catch { /* Safe terminal failure only. */ } }
}

async function readApi(page, path, kind) {
  const response = await page.evaluate(async ({ path, kind }) => {
    // Canonical Bearer storage is apps/web/lib/api-client.ts; token never leaves this host/browser context.
    const token = window.localStorage.getItem('wsx.sessionToken');
    if (!token) throw new Error('SESSION_TOKEN_MISSING');
    const response = await fetch(path, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'include', redirect: 'error', cache: 'no-store' });
    // Defense in depth: never parse/export an unexpectedly resolving project's response body.
    if (kind === 'member' && response.status === 200) { await response.body?.cancel(); return { status: 200, body: null }; }
    const reader = response.body?.getReader();
    let size = 0, text = ''; const decoder = new TextDecoder();
    if (reader) for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 65536) { await reader.cancel(); throw new Error('RESPONSE_BOUND'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    let body = null; try { body = JSON.parse(text); } catch { /* Non-JSON is an unknown gate. */ }
    return { status: response.status, body };
  }, { path, kind });
  return projectApiResponse(kind, response.status, response.body);
}

export async function main() {
  const guard = createRequestGuard();
  const report = { kind: 'devapp-aidt-auth-readonly-v1', target: ORIGIN, passed: false,
    scope: 'login-aidt-route-course-gate-only', memberFunctionalityVerified: false,
    login: null, aidtRoute: null, courses: null, member: null };
  let browser, context, timer, stage = 'credentials';
  const step = operation => Promise.race([operation, guard.failure.then(code => { throw new ProbeFailure(code); })]);
  try {
    if (process.argv.length !== 2) throw new ProbeFailure('ARGUMENTS_REJECTED');
    const { email, password } = readQaCredentials();
    timer = setTimeout(() => guard.fail('PROBE_TIMEOUT'), 90000);
    stage = 'browser';
    const { chromium } = await import('@playwright/test');
    const browserEnv = Object.fromEntries(['PATH', 'HOME', 'LANG', 'TZ', 'PLAYWRIGHT_BROWSERS_PATH']
      .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    browser = await step(chromium.launch({ headless: true, env: browserEnv }));
    context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', route => routeReadonly(route, guard, receipt => { report.login = receipt; }));
    if (typeof context.routeWebSocket !== 'function') throw new ProbeFailure('WEBSOCKET_GUARD_UNAVAILABLE');
    await context.routeWebSocket('**/*', socket => { guard.fail('WEBSOCKET_BLOCKED'); socket.close(); });
    const page = await context.newPage();
    page.on('download', () => guard.fail('DOWNLOAD_BLOCKED'));
    page.on('popup', () => guard.fail('POPUP_BLOCKED'));
    let aidtStatus = null;
    page.on('response', response => {
      if (response.request().resourceType() === 'document' && response.url() === `${ORIGIN}/aidt`) aidtStatus = response.status();
    });
    stage = 'login';
    await step(page.goto(`${ORIGIN}/login?next=%2Faidt`, { waitUntil: 'domcontentloaded', timeout: 20000 }));
    await step(page.getByTestId('login-email').fill(email));
    await step(page.getByTestId('login-password').fill(password));
    guard.armLogin();
    await step(page.getByTestId('login-submit').click());
    await step(page.waitForURL(`${ORIGIN}/aidt`, { waitUntil: 'domcontentloaded', timeout: 30000 }));
    if (!report.login?.authenticatedSessionSchema) throw new ProbeFailure('AUTHENTICATION_FAILED');
    stage = 'aidt-route';
    // LoginSessionGate may complete next=/aidt with router.replace/RSC rather than a document.
    // Preserve that exact URL assertion above, then verify one guarded GET re-entry in the same session.
    const reentry = await step(page.goto(`${ORIGIN}/aidt`, { waitUntil: 'domcontentloaded', timeout: 20000 }));
    aidtStatus = reentry?.status() ?? null;
    const homeObserved = aidtStatus === 200 && await step(page.getByTestId('aidt-home').waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false));
    report.aidtRoute = { httpStatus: aidtStatus, homeObserved: Boolean(homeObserved) };
    stage = 'courses';
    report.courses = await step(readApi(page, `${COURSES}?limit=1`, 'courses'));
    if ([401, 403].includes(report.courses.httpStatus)) throw new ProbeFailure('AUTHENTICATION_OR_ACCESS_FAILED');
    stage = 'member-gate';
    // Source: project-member-chat/service.ts checks enabled() before withTenant/project reads.
    // This fresh, never-created ID is not a QA group; non-MODULE_DISABLED results stay unverified.
    report.member = await step(readApi(page, `${guard.memberPath}?limit=1`, 'member'));
    report.passed = Boolean(homeObserved && report.courses.gate === 'available');
    if (!report.passed) report.failure = 'ROUTE_OR_MODULE_GATE_NOT_AVAILABLE';
  } catch (error) {
    report.failure = error instanceof ProbeFailure ? error.code : 'PROBE_STEP_FAILED';
    report.failedStage = stage;
  } finally {
    clearTimeout(timer);
    try { await context?.close(); } catch { report.passed = false; report.failure = 'BROWSER_CLEANUP_FAILED'; }
    try { await browser?.close(); } catch { report.passed = false; report.failure = 'BROWSER_CLEANUP_FAILED'; }
  }
  report.requests = guard.summary();
  if (guard.fatal()) { report.passed = false; report.failure = guard.fatal(); }
  console.log(JSON.stringify(report));
  process.exitCode = report.passed ? 0 : 1;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length === 3 && process.argv[2] === '--preflight') {
    try { readQaCredentials(); console.log('REAL_MODEL_E2E_EMAIL\nREAL_MODEL_E2E_PASSWORD'); }
    catch (error) { console.error(error instanceof ProbeFailure ? error.code : 'CREDENTIAL_FILE_UNAVAILABLE'); process.exitCode = 1; }
  } else await main();
}
