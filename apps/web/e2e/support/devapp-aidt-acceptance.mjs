/** Explicit live-Dev QA writer. No trace/video/storage-state or credential copies. */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ORIGIN, ProbeFailure, readQaCredentials } from './devapp-aidt-auth-readonly.mjs';
import { acceptanceIdentity, assertAcceptanceWorkflow, assertRuntimeProof, createAcceptanceGuard, assertScreenshotSafe, assertCaptureScope, SHA } from './devapp-aidt-acceptance-guard.mjs';

function safeCode(error) { return error instanceof ProbeFailure && /^[A-Z0-9_]{1,90}$/.test(error.code) ? error.code : 'UI_ACCEPTANCE_STEP_FAILED'; }

export async function enforceDeniedProbeStatus(decision, response) {
  if (decision.kind === 'denied-probe' && ![403, 404].includes(response.status())) {
    await response.dispose();
    throw new ProbeFailure('UNKNOWN_PROJECT_UNEXPECTED_RESPONSE');
  }
}

export function privateOutput(env, identity) {
  if (!env.RUNNER_TEMP?.startsWith('/') || /[\r\n]/.test(env.RUNNER_TEMP) || !SHA.test(env.GITHUB_SHA ?? '')) throw new ProbeFailure('PRIVATE_ROOT_INVALID');
  const root = resolve(env.RUNNER_TEMP, '..', `wsx-aidt-acceptance-${identity.run}-${identity.attempt}`);
  const info = lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700 || info.uid !== process.getuid()) throw new ProbeFailure('PRIVATE_ROOT_INVALID');
  const marker = lstatSync(resolve(root, '.owner'));
  if (!marker.isFile() || marker.isSymbolicLink() || (marker.mode & 0o777) !== 0o600) throw new ProbeFailure('PRIVATE_ROOT_OWNER_MISMATCH');
  const owner = readFileSync(resolve(root, '.owner'), 'utf8').trim();
  if (owner !== `${identity.run}:${identity.attempt}:${env.GITHUB_SHA}`) throw new ProbeFailure('PRIVATE_ROOT_OWNER_MISMATCH');
  const out = resolve(root, 'output');
  mkdirSync(out, { mode: 0o700 });
  return { root, out };
}

export function runtimeProof(identity, env = process.env) {
  const reader = fileURLToPath(new URL('../../../../scripts/image-release-host-permissions.py', import.meta.url));
  const code = 'import importlib.util,json,sys;s=importlib.util.spec_from_file_location("reader",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps({"aidtExactRelease":m.aidt_exact_release()}))';
  const result = spawnSync('/usr/bin/python3', ['-I', '-B', '-c', code, reader], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 1048576,
    env: { PATH: '/usr/bin:/bin', TARGET_ENVIRONMENT: 'devapp', AIDT_RELEASE_SOURCE: identity.source, AIDT_RELEASE_TAG: identity.tag },
  });
  if (result.status !== 0) throw new ProbeFailure('EXACT_RUNTIME_READ_FAILED');
  let proof; try { proof = JSON.parse(result.stdout); } catch { throw new ProbeFailure('EXACT_RUNTIME_PROOF_INVALID'); }
  return assertRuntimeProof(proof, identity);
}

async function api(page, method, path, body) {
  if (!path.startsWith('/api/') || path.startsWith('//') || /[\r\n#]/.test(path)) throw new ProbeFailure('API_PATH_REJECTED');
  return page.evaluate(async ({ method, path, body }) => {
    const token = localStorage.getItem('wsx.sessionToken');
    if (!token) throw new Error('SESSION_MISSING');
    const response = await fetch(path, { method, redirect: 'error', cache: 'no-store', credentials: 'include',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const reader = response.body?.getReader(); let size = 0, text = ''; const decoder = new TextDecoder();
    if (reader) for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 1048576) { await reader.cancel(); throw new Error('RESPONSE_BOUND'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode(); let data = null; try { data = JSON.parse(text); } catch { /* Fail through status/schema check. */ }
    return { status: response.status, data };
  }, { method, path, body });
}

export async function verifyPng(browser, bytes, minimumHeight = 200) {
  if (bytes.length < 512 || bytes.length > 8388608 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new ProbeFailure('SCREENSHOT_BYTES_INVALID');
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await context.route('**/*', route => route.abort('blockedbyclient'));
    const page = await context.newPage();
    const proof = await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), value => value.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(64, 64), ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('CANVAS_MISSING');
      ctx.drawImage(image, 0, 0, 64, 64);
      const data = ctx.getImageData(0, 0, 64, 64).data, colors = new Set();
      for (let i = 0; i < data.length; i += 4) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
      return { width: image.width, height: image.height, sampledColors: colors.size };
    }, bytes.toString('base64'));
    if (proof.width < 300 || proof.height < minimumHeight || proof.sampledColors < 8) throw new ProbeFailure('SCREENSHOT_EMPTY_OR_UNREADABLE');
    return proof;
  } finally { await context.close(); }
}

export function finalizeGuardVerdict(report, guard) {
  const code = guard?.fatal();
  if (code) {
    report.passed = false; report.fullAcceptancePassed = false;
    report.guardFailure = /^[A-Z0-9_]{1,90}$/.test(code) ? code : 'SAFETY_GUARD_STOPPED';
    report.failure ??= report.guardFailure;
  }
  return report;
}

export async function main() {
  // These variables can expose Playwright fill arguments; remove before importing its API.
  for (const key of ['DEBUG', 'PWDEBUG', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'NODE_OPTIONS']) delete process.env[key];
  const report = { kind: 'devapp-aidt-ui-acceptance-v1', target: ORIGIN, passed: false, syntheticData: true,
    classroomValidated: false, realModelVerified: false, crossUserIsolationVerified: false,
    controlSource: null, deployedRuntime: null, deploymentLockHeld: false, runtimeRechecks: 0,
    checkpoints: [], screenshots: [], scope: 'writes and screenshots: new owned QA project only',
    authorizedMetadataReads: 'Native clients also read the QA-authorized identity, course/project/Skill catalogs and Design list in memory. No raw lists or unrelated projects are exported.',
    designRequestLimit: 'At most one normal UI Design chat request; default page count is decided by the existing service, not capped to one page.' };
  let browser, context, page, output, identity, guard, credentials, timer, stage = 'preflight';
  try {
    if (process.argv.length !== 2) throw new ProbeFailure('ARGUMENTS_REJECTED');
    assertAcceptanceWorkflow(process.env);
    identity = acceptanceIdentity(process.env);
    report.controlSource = process.env.GITHUB_SHA;
    report.executionMode = identity.entryDiagnosticOnly ? 'entry-diagnostic-readonly' : 'ordinary-ui-first-full';
    report.fullAcceptancePassed = false;
    report.requirements = { source: 'docs/requirements/aidt-v2-full.md', declaredVersion: 'V2 with 2026-11-15 FR15-FR19', independentVrOriginal: 'not located; do not infer VR compliance' };
    report.stageIterations = [];
    output = privateOutput(process.env, identity);
    const metadata = JSON.parse(readFileSync(new URL('../../../../acceptance-source.json', import.meta.url), 'utf8'));
    if (metadata.controlSource !== process.env.GITHUB_SHA || !Array.isArray(metadata.teachingSkillNames) || metadata.teachingSkillNames.length < 6) throw new ProbeFailure('SOURCE_BUNDLE_INVALID');
    identity.teachingSkillNames = metadata.teachingSkillNames;
    identity.deniedProject = `prj-${randomUUID()}`;
    report.deployedRuntime = runtimeProof(identity);
    credentials = readQaCredentials();
    const { chromium, expect } = await import('@playwright/test');
    guard = createAcceptanceGuard(identity);
    timer = setTimeout(() => { guard.fail('ACCEPTANCE_TIMEOUT'); void context?.close(); }, 30 * 60 * 1000);
    const browserEnv = Object.fromEntries(['PATH', 'HOME', 'LANG', 'TZ', 'PLAYWRIGHT_BROWSERS_PATH'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    browser = await chromium.launch({ headless: true, env: browserEnv });
    report.browser = { name: 'Chromium', version: browser.version(), playwrightVersion: metadata.playwrightVersion, headless: true };
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
    await context.route('**/*', async route => {
      const request = route.request();
      try {
        let body;
        if (request.method() !== 'GET') {
          const raw = request.postDataBuffer();
          if (raw && raw.length > 1048576) throw new ProbeFailure('REQUEST_BODY_BOUND');
          const contentType = request.headers()['content-type'] ?? '';
          if (contentType.startsWith('multipart/form-data;')) {
            const form = await new Response(raw, { headers: { 'content-type': contentType } }).formData();
            if ([...form.keys()].sort().join(',') !== 'files,meta') throw new ProbeFailure('UPLOAD_FORM_REJECTED');
            const file = form.get('files');
            if (typeof file === 'string' || !file || file.size > 262144) throw new ProbeFailure('UPLOAD_FORM_REJECTED');
            const bytes = Buffer.from(await file.arrayBuffer());
            let meta; try { meta = JSON.parse(form.get('meta')); } catch { throw new ProbeFailure('UPLOAD_FORM_REJECTED'); }
            body = { __multipart: true, meta, files: [{ filename: file.name, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mime: file.type }] };
          } else { try { body = request.postDataJSON(); } catch { throw new ProbeFailure('REQUEST_BODY_UNSUPPORTED'); } }
        }
        const decision = guard.decide({ url: request.url(), method: request.method(), body, resourceType: request.resourceType() });
        if (!decision.allow) return await route.abort('blockedbyclient');
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: decision.kind === 'design-generation' ? 900000 : 30000 });
        await enforceDeniedProbeStatus(decision, response);
        if (response.status() >= 300 && response.status() < 400) throw new ProbeFailure('REDIRECT_REJECTED');
        let parsed;
        if (decision.kind === 'upload-content') {
          const bytes = await response.body();
          if (bytes.length > 262144) throw new ProbeFailure('RESPONSE_BOUND');
          guard.observeContent(decision, response.status(), response.headers(), bytes);
        } else if (!['read', 'denied-probe', 'aidt-tag', 'mount-owned-thread'].includes(decision.kind)) {
          const bytes = await response.body();
          if (bytes.length > 1048576) throw new ProbeFailure('RESPONSE_BOUND');
          try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new ProbeFailure('RESPONSE_SCHEMA_INVALID'); }
        }
        guard.observe(decision, response.status(), parsed);
        // Bind only the actual created candidate before the normal UI resumes.
        if (decision.kind === 'create-project' && [200, 201].includes(response.status())) {
          const id = guard.identity().candidate;
          const overview = await api(page, 'GET', `/api/projects/${id}/overview`);
          const membership = await api(page, 'GET', `/api/projects/${id}/collaborators`);
          if (overview.status !== 200 || membership.status !== 200) throw new ProbeFailure('QA_PROJECT_OWNERSHIP_READ_FAILED');
          guard.bindOwnedProject(overview.data, membership.data?.members);
        }
        await route.fulfill({ response });
      } catch (error) { guard.fail(safeCode(error)); try { await route.abort('blockedbyclient'); } catch { /* Already closed. */ } }
    });
    if (typeof context.routeWebSocket !== 'function') throw new ProbeFailure('WEBSOCKET_GUARD_UNAVAILABLE');
    await context.routeWebSocket('**/*', socket => socket.close());
    page = await context.newPage(); page.setDefaultTimeout(15000);
    stage = 'login';
    await page.goto(`${ORIGIN}/login?next=%2Faidt`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('login-email').fill(credentials.email);
    await page.getByTestId('login-password').fill(credentials.password);
    guard.armLogin(); await page.getByTestId('login-submit').click();
    await page.waitForURL(`${ORIGIN}/aidt`, { waitUntil: 'domcontentloaded' });
    if (!guard.identity().actor) throw new ProbeFailure('AUTHENTICATION_FAILED');
    report.login = { authenticated: true, loginRequests: 1 };
    const recheckRuntime = () => {
      const observed = runtimeProof(identity);
      if (JSON.stringify(observed) !== JSON.stringify(report.deployedRuntime)) { guard.fail('RUNTIME_CHANGED_DURING_ACCEPTANCE'); throw new ProbeFailure('RUNTIME_CHANGED_DURING_ACCEPTANCE'); }
      report.runtimeRechecks++;
    };
    const capture = async (name, expectedStage, region = 'workspace') => {
      if (!/^[a-z0-9][a-z0-9-]{0,85}$/.test(name)) throw new ProbeFailure('SCREENSHOT_NAME_INVALID');
      if (region === 'workspace') assertCaptureScope(page.url(), guard.identity().projectId, expectedStage);
      else { const url = new URL(page.url()); if (url.origin !== ORIGIN || url.pathname !== '/aidt' || !['home-create-actions', 'create-dialog'].includes(region)) throw new ProbeFailure('SCREENSHOT_SCOPE_REJECTED'); }
      recheckRuntime();
      const workspace = region === 'workspace' ? page.getByTestId('aidt-project-workspace') : region === 'home-create-actions' ? page.getByRole('heading', { name: '我的工作坊', exact: true }).locator('..') : page.getByRole('dialog').filter({ has: page.getByTestId('project-new-details') });
      await workspace.waitFor({ state: 'visible' });
      if (region === 'workspace') await page.keyboard.press('Escape');
      const sensitive = await workspace.evaluate((root, { email, password }) => {
        const visible = node => node instanceof HTMLElement && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
        const values = [root.innerText, ...[...root.querySelectorAll('input,textarea,[contenteditable="true"]')].filter(visible).map(node => 'value' in node ? node.value : node.innerText)].join('\n');
        const token = localStorage.getItem('wsx.sessionToken');
        return [email, password, token].some(secret => typeof secret === 'string' && secret.length > 0 && values.includes(secret)) || /Bearer\s+[A-Za-z0-9._~-]{12,}|\bsk-[A-Za-z0-9]{16,}/.test(values);
      }, { email: credentials.email, password: credentials.password });
      if (sensitive) throw new ProbeFailure('SCREENSHOT_SENSITIVE_CONTENT');
      const bytes = await workspace.screenshot({ type: 'png', animations: 'disabled' });
      const dimensions = await verifyPng(browser, bytes, region === 'workspace' ? 200 : 24), filename = `${name}.png`;
      writeFileSync(resolve(output.out, filename), bytes, { flag: 'wx', mode: 0o600 });
      report.screenshots.push({ filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...dimensions, stage: expectedStage ?? null, region });
    };
    const checkpoint = async (name, operation) => {
      if (!/^[a-z0-9][a-z0-9-]{0,90}$/.test(name)) throw new ProbeFailure('CHECKPOINT_NAME_INVALID');
      if (guard.fatal()) { report.checkpoints.push({ name, status: 'blocked', code: guard.fatal() }); return false; }
      const startedUTC = new Date().toISOString(), tick = performance.now();
      console.log(JSON.stringify({ event: 'checkpoint-start', name, startedUTC, maximumMinutes: 15 }));
      const record = result => { const durationMs = Math.round(performance.now() - tick); const item = { name, ...result, startedUTC, finishedUTC: new Date().toISOString(), durationMs, maximumMinutes: 15, timedOut: durationMs > 900000 }; report.checkpoints.push(item); console.log(JSON.stringify({ event: 'checkpoint-finish', ...item })); };
      try { recheckRuntime(); await operation(); record({ status: 'passed' }); return true; }
      catch (error) {
        record({ status: 'failed', code: safeCode(error) });
        try { await capture(`${name}-failed`); } catch { report.checkpoints.push({ name: `${name}-capture`, status: 'blocked', code: 'FAILURE_SCREENSHOT_UNAVAILABLE' }); }
        return false;
      }
    };
    stage = 'ordinary-identity-and-home-entry';
    const me = await api(page, 'GET', `/api/identity/me?orgId=${encodeURIComponent(guard.identity().org)}`);
    report.actor = guard.readIdentityRole(me.status, me.data);
    await expect(page.getByTestId('aidt-home')).toBeVisible();
    if (identity.entryDiagnosticOnly) {
      report.kind = 'devapp-aidt-entry-diagnostic-v1';
      const visible = await page.getByTestId('aidt-new').isVisible();
      await capture('00-home-create-actions', undefined, 'home-create-actions');
      report.entryDiagnostic = { completed: true, orgRole: report.actor.orgRole, creationEntryVisible: visible,
        ordinaryQaSuitable: report.actor.ordinaryConsultant, missingEntryReproduced: report.actor.ordinaryConsultant && !visible,
        writesOtherThanLogin: 0, scope: 'read-only entry observation; not creation or six-stage acceptance' };
      report.passed = true;
      return;
    }
    guard.verifyOrdinaryIdentity(me.status, me.data);
    const homeCreated = await checkpoint('homepage-ui-create-persist', async () => {
      await capture('00-home-create-actions', undefined, 'home-create-actions');
      await expect(page.getByTestId('aidt-new')).toBeVisible(); await page.getByTestId('aidt-new').click();
      await page.getByTestId('project-new-name').fill(identity.projectName);
      await capture('00-create-dialog', undefined, 'create-dialog');
      guard.armProjectCreate(); await page.getByTestId('project-new-create').click();
      await expect.poll(() => guard.identity().projectId).toMatch(/^prj-/);
      const id = guard.identity().projectId;
      await page.waitForURL(`${ORIGIN}/aidt/${id}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('aidt-dashboard')).toBeVisible();
      for (let n = 1; n <= 6; n++) await expect(page.getByTestId(`aidt-step-${n}`)).toBeVisible();
      report.project = { id, name: identity.projectName, ownerVerified: true, profile: 'aidt', setup: 'normal-homepage-UI', ordinaryConsultant: true };
      await capture('00-created-six-stage-overview');
      await page.goto(`${ORIGIN}/aidt`); await expect(page.getByTestId(`aidt-project-${id}`)).toBeVisible();
      await page.reload(); await expect(page.getByTestId(`aidt-project-${id}`)).toBeVisible();
      await page.getByTestId(`aidt-project-${id}`).click(); await expect(page.getByTestId('aidt-dashboard')).toBeVisible();
      await capture('00-created-reentry-overview');
    });
    if (!homeCreated) throw new ProbeFailure('HOMEPAGE_UI_CREATION_NOT_ACCEPTED');
    const projectId = guard.identity().projectId;
    const saveStage = async (n, visibleButton) => {
      const button = visibleButton ?? page.getByTestId('aidt-shared-save');
      await expect(button).toBeVisible(); await expect(button).toBeEnabled();
      guard.armStageSave(n, false); await button.click();
      if (!visibleButton) await expect(page.getByTestId('aidt-shared-status')).toContainText('小组已保存');
    };
    const reviewAndSave = async (n, button) => {
      await expect(button).toBeVisible(); await expect(button).toBeEnabled();
      guard.armStageSave(n, true); await button.click();
    };
    const saveReport = async () => {
      const button = page.getByTestId('aidt-report-save');
      await expect(button).toBeVisible(); await expect(button).toBeEnabled();
      guard.armStageSave(6, false); await button.click();
      await expect(page.getByTestId('aidt-report-save-state')).toContainText('已保存');
    };
    const createAnonymousPage = async () => {
      const anonymous = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      await anonymous.route('**/*', async route => {
        const request = route.request(); let target;
        try { target = new URL(request.url()); } catch { return route.abort('blockedbyclient'); }
        const allowed = target.origin === ORIGIN && !target.username && !target.password && request.method() === 'GET' && !/%2e|%2f|%5c/i.test(request.url().split('?')[0])
          && (target.pathname === '/login' || target.pathname === `/aidt/${projectId}` || target.pathname.startsWith('/_next/static/') || target.pathname === '/favicon.ico' || target.pathname === '/api/identity/me' || target.pathname.startsWith(`/api/projects/${projectId}/`));
        if (!allowed) return route.abort('blockedbyclient');
        try { const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 }); await route.fulfill({ response }); }
        catch { await route.abort('blockedbyclient'); }
      });
      await anonymous.routeWebSocket('**/*', socket => socket.close());
      return { page: await anonymous.newPage(), close: () => anonymous.close() };
    };
    const saveDownload = async download => {
      const path = await download.path();
      if (!path || !download.suggestedFilename().endsWith('.md')) throw new ProbeFailure('REPORT_DOWNLOAD_INVALID');
      const info = lstatSync(path); if (!info.isFile() || info.size < 80 || info.size > 1048576) throw new ProbeFailure('REPORT_DOWNLOAD_INVALID');
      const bytes = readFileSync(path), text = bytes.toString('utf8');
      assertScreenshotSafe(text, [credentials.email, credentials.password]);
      const leakedToken = await page.evaluate(text => { const token = localStorage.getItem('wsx.sessionToken'); return Boolean(token && text.includes(token)); }, text);
      if (leakedToken || !text.includes('合成') || /Bearer\s+[A-Za-z0-9._~-]{12,}|\bsk-[A-Za-z0-9]{16,}/.test(text)) throw new ProbeFailure('REPORT_DOWNLOAD_SENSITIVE');
      const filename = `qa-report-${identity.run}.md`;
      writeFileSync(resolve(output.out, filename), bytes, { flag: 'wx', mode: 0o600 });
      report.download = { filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), humanReadableUtf8: true };
      return report.download;
    };
    stage = 'six-stage-journey';
    const { runAidtJourney, REQUIRED_CHECKS } = await import('./devapp-aidt-journey.mjs');
    if (!Array.isArray(REQUIRED_CHECKS) || REQUIRED_CHECKS.length < 6) throw new ProbeFailure('JOURNEY_REQUIREMENTS_INVALID');
    await checkpoint('unknown-project-denied', async () => {
      const result = await api(page, 'GET', `/api/projects/${identity.deniedProject}/overview`);
      if (![403, 404].includes(result.status)) throw new ProbeFailure('UNKNOWN_PROJECT_NOT_DENIED');
      report.unknownProjectGate = { passed: true, status: result.status, crossUserIsolation: false };
    });
    await runAidtJourney({ page, context, expect, scope: { projectId, projectName: identity.projectName, runId: identity.run, runAttempt: identity.attempt, source: identity.source, tag: identity.tag, syntheticLabel: '合成验收数据，非真实访谈' },
      checkpoint, capture, api: path => api(page, 'GET', path), saveStage, reviewAndSave, saveReport, saveDownload,
      registerFixture: fixture => guard.registerFixture(fixture), armDesignCreate: () => guard.armDesignCreate(), armDesignGeneration: () => guard.armDesignGeneration(), createAnonymousPage, report });
    const after = runtimeProof(identity);
    if (JSON.stringify(after) !== JSON.stringify(report.deployedRuntime)) throw new ProbeFailure('RUNTIME_CHANGED_DURING_ACCEPTANCE');
    report.requiredChecks = ['homepage-ui-create-persist', 'unknown-project-denied', ...REQUIRED_CHECKS];
    report.passed = !guard.fatal() && report.requiredChecks.every(name => report.checkpoints.some(item => item.name === name && item.status === 'passed'));
    report.fullAcceptancePassed = report.passed;
    if (!report.passed) report.failure = guard.fatal() ?? 'REQUIRED_CHECKS_NOT_ALL_PASSED';
  } catch (error) { report.failure = safeCode(error); report.failedStage = stage; }
  finally {
    clearTimeout(timer);
    try { await context?.close(); } catch { /* No raw errors. */ }
    try { await browser?.close(); } catch { /* No raw errors. */ }
    if (guard) {
      report.requestScope = guard.summary();
      report.designGenerationWorkflowObserved = report.requestScope.designModel?.httpStatus === 200 && report.requestScope.designModel?.generatedFrames > 0;
      report.designProviderIndependentlyVerified = false;
      report.cleanup = { performed: false, reason: 'No delete API; consultant is not entitled to project lifecycle archive. Keep labelled synthetic QA project and evidence; no privilege escalation.' };
    }
    finalizeGuardVerdict(report, guard);
    if (output) writeFileSync(resolve(output.out, 'acceptance.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ kind: report.kind, passed: report.passed, failure: report.failure ?? null,
      source: identity?.source ?? null, tag: identity?.tag ?? null, checkpoints: report.checkpoints, screenshots: report.screenshots.map(({ filename, bytes, sha256 }) => ({ filename, bytes, sha256 })) }));
    process.exitCode = report.passed ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
