/** Explicit live-Dev QA writer. No trace/video/storage-state or credential copies. */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, lstatSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ORIGIN, ProbeFailure, readQaCredentials } from './devapp-aidt-auth-readonly.mjs';
import { consumeReusableQaCredentials, reusableQaRequested } from './devapp-aidt-qa-identity.mjs';
import { acceptanceIdentity, assertAcceptanceWorkflow, assertRuntimeProof, createAcceptanceGuard, assertScreenshotSafe, assertCaptureScope, SHA } from './devapp-aidt-acceptance-guard.mjs';
import { captureApplicationPrint } from './devapp-aidt-print-evidence.mjs';
import { sendTeachingFeedback, validateTeachingEvidence } from './devapp-aidt-chat-evidence.mjs';
import { agentQaReviewRequested, createAgentQaReviewer } from './devapp-aidt-agent-review.mjs';
import { aidtCreateTagInput } from './devapp-aidt-journey.mjs';
import { acceptanceProfile, V2_VOICE_PROFILE, createV2ExecutionLedger } from './devapp-aidt-v2-profile.mjs';
import { createV2VoicePlan } from './devapp-aidt-v2-plan.mjs';
import { createV2AcceptanceGuard } from './devapp-aidt-v2-request-guard.mjs';
import { probeNativePrintCapabilities, prepareOwnedNativePrint, createNativePrintDriver } from './devapp-aidt-v2-print.mjs';
import { createV2ActionWindow } from './devapp-aidt-v2-action-window.mjs';
import { createV2NativeActionObserver, prepareV2NativeExpected } from './devapp-aidt-v2-native-feedback.mjs';
import { createEntryClock, verifyEntryWorkspace, createEntryPublisher } from "./devapp-aidt-entry-proof.mjs";

export function readV2SyntheticAudioFixture(metadata, identity) {
  const fixture=metadata.syntheticAudioFixture,path='apps/web/e2e/fixtures/aidt-v2/synthetic-prototype-test.wav';
  if(!fixture||fixture.path!==path||fixture.synthetic!==true||fixture.groundtruthSentToModel!==false||fixture.mime!=='audio/wav'||!Number.isSafeInteger(fixture.bytes)||fixture.bytes<44||fixture.bytes>262144||!/^[a-f0-9]{64}$/.test(fixture.sha256??''))throw new ProbeFailure('V2_SYNTHETIC_AUDIO_METADATA_INVALID');
  const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size!==fixture.bytes)throw new ProbeFailure('V2_SYNTHETIC_AUDIO_FILE_UNVERIFIED');
  const bytes=readFileSync(path);if(createHash('sha256').update(bytes).digest('hex')!==fixture.sha256||bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WAVE')throw new ProbeFailure('V2_SYNTHETIC_AUDIO_BYTES_UNVERIFIED');
  return {filename:`qa-${identity.run}-synthetic-prototype-test.wav`,bytes,mime:fixture.mime,synthetic:true};
}

export function visibleAidtQaProjects(projects, ownedProjectId) {
  if (!Array.isArray(projects) || projects.some(project => !project || typeof project.id !== 'string')) {
    throw new ProbeFailure('QA_PROJECT_CATALOG_INVALID');
  }
  if (!ownedProjectId) return [];
  const matches = projects.filter(project => project.id === ownedProjectId);
  if (matches.length > 1) throw new ProbeFailure('QA_PROJECT_CATALOG_INVALID');
  return matches;
}

export function illustratedAcceptance(report) {
  const headings = ['首页', '理解与提出问题', '共情用户', '综合与定义', '创意发散', '制作原型', '测试与迭代', '最终报告'];
  const status = value => ({ passed: '通过', pass: '通过', failed: '失败', blocked: '阻塞' })[value] ?? '待核验';
  const lines = ['# AIDT Devapp 图文验收报告', '', '候选版本 \`' + report.source + '\`。本次使用合成教学材料。', '',
    ...(report.agentReview ? ['**执行者：测试智能体；仅 SOFTWARE QA，不是人类课堂或教师教学签核。**', ''] : []),
    '**整体结果 ' + (report.fullAcceptancePassed ? '通过' : report.passed ? '浏览器验收通过，PDF 字形独立核验待完成' : '未全部通过') + '**', ''];
  for (const [index, title] of headings.entries()) {
    const section = index === 7 ? /^(report-|teaching-chat-final-report)/ : index === 0 ? /^homepage-/ : new RegExp('^(s' + index + '-|teaching-chat-stage-' + index + '(?:-|$))');
    const checks = report.checkpoints.filter(row => section.test(row.name));
    const screens = report.screenshots.filter(row => report.acceptanceProfile === V2_VOICE_PROFILE
      ? (index === 0 ? row.stage === null : index === 7 ? /report/i.test(row.filename) : row.stage === index) && /^[A-Za-z0-9-]+\.png$/.test(row.filename)
      : row.filename.startsWith(String(index).padStart(2, '0') + '-') && /^[a-z0-9-]+\.png$/.test(row.filename));
    lines.push('## ' + title, '');
    if (!checks.length) lines.push('未取得检查结果。', '');
    for (const check of checks) lines.push('- ' + status(check.status) + '　\`' + check.name + '\`' + (check.code ? '　\`' + check.code + '\`' : ''));
    const stageFile = report.stageFileEvidence?.find(row => row.stageId === index && row.uiReloadVerified && row.contentVerified);
    if (stageFile) lines.push('- 原生 Chat 附件 `' + stageFile.filename + '` 已刷新回读，原件 SHA-256 `' + stageFile.sha256 + '`。');
    lines.push('');
    for (const image of screens) {
      const label = image.filename.replace(/\.png$/, '');
      lines.push('![' + title + ' ' + label + '](./' + image.filename + ')', '');
    }
  }
  return lines.join('\n');
}

function safeCode(error) { return error instanceof ProbeFailure && /^[A-Z0-9_]{1,90}$/.test(error.code) ? error.code : 'UI_ACCEPTANCE_STEP_FAILED'; }

export async function enforceDeniedProbeStatus(decision, response) {
  if (decision.kind === 'denied-probe' && ![403, 404].includes(response.status())) {
    await response.dispose();
    throw new ProbeFailure('UNKNOWN_PROJECT_UNEXPECTED_RESPONSE');
  }
}

export function privateOutput(env, identity) {
  if (!env.RUNNER_TEMP?.startsWith('/') || /[\r\n]/.test(env.RUNNER_TEMP) || !SHA.test(env.GITHUB_SHA ?? '')) throw new ProbeFailure('PRIVATE_ROOT_INVALID');
  const root = resolve(realpathSync(resolve(env.RUNNER_TEMP, '..')), `wsx-aidt-acceptance-${identity.run}-${identity.attempt}`);
  if (env.AIDT_ACCEPTANCE_ROOT !== root) throw new ProbeFailure('PRIVATE_ROOT_COLLECTOR_MISMATCH');
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

// This is the approved per-journey evidence set, not a general increase in printing/model work.
export const AIDT_PDF_PLAN = Object.freeze([
  ...Array.from({ length: 10 }, (_item, index) => Object.freeze({ stage: 2, name: `interview-guide-u${String(index + 1).padStart(2, '0')}` })),
  Object.freeze({ stage: 2, name: 'discovery-card-u01-with-photo' }), Object.freeze({ stage: 2, name: 'discovery-card-u02-photo-missing' }),
  ...Array.from({ length: 3 }, (_item, index) => Object.freeze({ stage: 4, name: `idea-description-${index + 1}` })),
  Object.freeze({ stage: 6, name: 'confirmed-group-report' }),
]);
export function assertAidtPrintRequest(stage, name, artifacts) {
  const key = typeof name === 'string' ? name.toLowerCase() : '';
  if (!Array.isArray(artifacts) || !AIDT_PDF_PLAN.some(item => item.name === key && item.stage === stage)
    || artifacts.filter(item => item.format === 'pdf').length >= AIDT_PDF_PLAN.length
    || artifacts.some(item => item.format === 'pdf' && item.printName === key)) throw new ProbeFailure('PRINT_ARTIFACT_BOUND');
  return key;
}

export function publicEntryDiagnostic(report) {
  const role = report.actor?.orgRole;
  const result = {};
  if (['consultant', 'lead', 'admin', 'compliance'].includes(role)) {
    result.orgRole = role;
    result.ordinaryQaSuitable = role === 'consultant';
  }
  if (report.entryDiagnostic?.completed === true && typeof report.entryDiagnostic.creationEntryVisible === 'boolean') result.creationEntryVisible = report.entryDiagnostic.creationEntryVisible;
  return result;
}

export function reusableQaIdentityFingerprint(identity, configured, provisioning) {
  if (provisioning ? Boolean(configured) : !/^[a-f0-9]{64}$/.test(configured ?? '')) {
    throw new ProbeFailure('QA_REUSABLE_IDENTITY_CONFIGURATION_INVALID');
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(['devapp-aidt-qa-v1', identity.actor, identity.org])).digest('hex');
  if (!provisioning && fingerprint !== configured) throw new ProbeFailure('QA_REUSABLE_IDENTITY_MISMATCH');
  return fingerprint;
}

export function ordinaryQaProvisioningRequested(env, identity) {
  const choice = env.AIDT_PROVISION_ORDINARY_QA;
  if (choice !== undefined && !['false', 'true'].includes(choice)) throw new ProbeFailure('QA_IDENTITY_OPT_IN_INVALID');
  if (choice !== 'true') return false;
  if (env.AIDT_LIVE_DEV !== 'true' || (identity.entryDiagnosticOnly && !reusableQaRequested(env))) throw new ProbeFailure('QA_IDENTITY_OPT_IN_SCOPE_INVALID');
  return true;
}

/** Secrets stay in memory and all evidence producers share the same collection. */
export function sensitiveEvidenceGuard() {
  const secrets = new Set();
  return Object.freeze({
    remember(value) {
      if (typeof value !== 'string' || !value || value.length > 16384 || (!secrets.has(value) && secrets.size >= 128)) throw new ProbeFailure('QA_SECRET_COLLECTION_BOUND');
      secrets.add(value);
    },
    values: () => [...secrets],
    assertSafe: text => assertScreenshotSafe(text, [...secrets]),
  });
}

export function assertProvisionedOrdinaryQa(expected, loginIdentity, status, me) {
  if (!expected || !['userId','adminUserId','orgId'].every(key => typeof expected[key] === 'string' && expected[key].length > 0 && expected[key].length <= 256)
      || expected.userId === expected.adminUserId || loginIdentity.actor !== expected.userId || loginIdentity.actor === expected.adminUserId
      || loginIdentity.org !== expected.orgId || status !== 200 || me?.org?.id !== expected.orgId || me?.orgRole !== 'consultant') throw new ProbeFailure('QA_IDENTITY_UI_BINDING_MISMATCH');
  return true;
}

/** Receipts come only from the helper's canonical owned-human/run/pin observation. */
export function pendingTeachingReviewReceipt(receipt, scope, currentUrl, pin) {
  const keys = ['projectId','stageId','threadId','runId','inputMessageId','permissionRequestId','toolName','knownConfirmTaskIntent','argumentFields','argumentShapeKnown'];
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(value);
  if (!receipt || Object.keys(receipt).length !== keys.length || !keys.every(key => Object.hasOwn(receipt, key))
    || receipt.projectId !== scope.projectId || receipt.stageId !== scope.stageId || receipt.threadId !== scope.threadId
    || ![receipt.runId,receipt.inputMessageId].every(validId) || receipt.permissionRequestId !== null && !validId(receipt.permissionRequestId)
    || !['confirm_task_intent','other'].includes(receipt.toolName) || receipt.knownConfirmTaskIntent !== (receipt.toolName === 'confirm_task_intent')
    || typeof receipt.argumentShapeKnown !== 'boolean' || !Array.isArray(receipt.argumentFields) || receipt.argumentFields.length > 3
    || new Set(receipt.argumentFields.map(field => field?.name)).size !== receipt.argumentFields.length
    || receipt.argumentFields.some(field => !field || Object.keys(field).length !== 2 || !['requestId','understanding','assumptions'].includes(field.name) || !['string','array-of-strings','other'].includes(field.type))) throw new ProbeFailure('TOOL_REVIEW_RECEIPT_INVALID');
  let url; try { url = new URL(currentUrl); } catch { throw new ProbeFailure('TOOL_REVIEW_SCOPE_UNVERIFIED'); }
  if (scope.origin !== ORIGIN || url.origin !== ORIGIN || url.username || url.password || url.pathname !== `/aidt/${scope.projectId}`
    || url.searchParams.getAll('step').length !== 1 || url.searchParams.get('step') !== String(scope.stageId)
    || url.searchParams.getAll('thread').length !== 1 || url.searchParams.get('thread') !== scope.threadId
    || url.searchParams.getAll('entity').length !== (scope.selector.entityId === undefined ? 0 : 1)
    || (url.searchParams.get('entity') ?? undefined) !== scope.selector.entityId
    || !pin || pin.skillId !== scope.skillId || pin.skillVersionId !== scope.skillVersionId) throw new ProbeFailure('TOOL_REVIEW_SCOPE_UNVERIFIED');
  return { projectId: receipt.projectId, stageId: receipt.stageId, threadId: receipt.threadId, runId: receipt.runId,
    inputMessageId: receipt.inputMessageId, permissionRequestId: receipt.permissionRequestId, toolName: receipt.toolName,
    knownConfirmTaskIntent: receipt.knownConfirmTaskIntent, argumentFields: receipt.argumentFields.map(field => ({ name: field.name, type: field.type })), argumentShapeKnown: receipt.argumentShapeKnown };
}

/** Open only this native approval surface. Never decide, edit, resume or send. */
export async function observePendingTeachingReview({ page, capture }) {
  let dialogObserved = false;
  const blocked = code => ({ status: 'not-captured', code, dialogObserved, captured: false, domRequestIdentityVerified: false });
  try {
    const native = page.getByTestId('aidt-project-workspace').getByTestId('restored-run-approval');
    if (await native.count() > 1) return blocked('TOOL_REVIEW_NATIVE_SURFACE_NOT_UNIQUE');
    await native.waitFor({ state: 'visible', timeout: 5000 });
    if (await native.count() !== 1) return blocked('TOOL_REVIEW_NATIVE_SURFACE_NOT_UNIQUE');
    const dialog = page.getByTestId('chat-tool-permission-dialog');
    if (await dialog.count() > 1) return blocked('TOOL_REVIEW_DIALOG_NOT_UNIQUE');
    if (await dialog.count() === 0 || !await dialog.isVisible()) {
      const open = native.getByRole('button', { name: /^(?:打开待确认请求|继续补充信息|打开工具审批|Open pending request|Continue adding details|Open tool approval)$/ });
      if (await open.count() !== 1 || !await open.isVisible() || !await open.isEnabled()) return blocked('TOOL_REVIEW_OPEN_UNAVAILABLE');
      await open.click();
    }
    await dialog.waitFor({ state: 'visible', timeout: 5000 });
    if (await dialog.count() !== 1) return blocked('TOOL_REVIEW_DIALOG_NOT_UNIQUE');
    dialogObserved = true;
    await capture();
    return { status: 'captured', code: null, dialogObserved, captured: true, domRequestIdentityVerified: false };
  } catch { return blocked('TOOL_REVIEW_CAPTURE_UNAVAILABLE'); }
}

/** Keep the upstream owned-run diagnostic beside, never inside, the safe receipt. */
export function recordTeachingEvent(event, scope, pendingReviews, assertSafe, emit) {
  assertSafe(JSON.stringify(event));
  let matched = false;
  if (event?.event === 'teaching-tool-review-required') {
    const keys = ['event','runId','threadId','stageId','toolName','approvalVisible','dialogOpened'];
    // This event has no argument values. Refuse unexpected fields rather than log them.
    if (Object.keys(event).length !== keys.length || !keys.every(key => Object.hasOwn(event, key))
      || event.toolName !== null && (typeof event.toolName !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(event.toolName))
      || ![true,false,null].includes(event.approvalVisible) || ![true,false,null].includes(event.dialogOpened)
      || event.dialogOpened === true && event.approvalVisible === false) return false;
    const entry = pendingReviews.find(item => item.receipt?.projectId === scope.projectId
      && item.receipt.stageId === scope.stageId && item.receipt.threadId === scope.threadId
      && item.receipt.runId === event.runId && event.stageId === scope.stageId && event.threadId === scope.threadId);
    if (entry) {
      entry.observedToolName = event.toolName;
      entry.approvalVisible = event.approvalVisible;
      entry.dialogOpened = event.dialogOpened;
      matched = true;
    }
  }
  emit(event);
  return matched;
}

/** New profile only. Observe failure without pretending a missing desktop is a site defect. */
export async function prepareV2Browser({ chromium, outputRoot, assertSafe, browserEnv, io = {} }) {
  const probe = io.probe ?? probeNativePrintCapabilities, prepare = io.prepare ?? prepareOwnedNativePrint;
  const createDriver = io.createDriver ?? createNativePrintDriver;
  let ownedRuntime, browser, context, driver;
  let capability = probe({ env: process.env, outputRoot });
  if (capability.available) {
    try {
      ownedRuntime = await prepare({ env: process.env, outputRoot });
      if (!ownedRuntime.available) throw new ProbeFailure(ownedRuntime.blockCode ?? 'NATIVE_SYSTEM_PRINT_CAPABILITY_BLOCKED');
      context = await chromium.launchPersistentContext(ownedRuntime.userDataDir, { ...ownedRuntime.launchOptions, viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
      browser = context.browser();
      driver = await createDriver({ browser, context, outputRoot, ownedRuntime, assertSafe });
      const actual = await driver.preflight();
      capability = { ...capability, ...actual };
      if (!actual.available) throw new ProbeFailure(actual.blockCode ?? 'NATIVE_SYSTEM_PRINT_CAPABILITY_BLOCKED');
      return { browser, context, driver, ownedRuntime, capability, headless: false };
    } catch (error) {
      capability = { available: false, blockCode: safeCode(error), missing: capability.missing ?? [], scope: 'This host and this owned browser only; no product failure is inferred. Functional QA continues without a fake PDF path.' };
      await driver?.dispose().catch(() => {}); await context?.close().catch(() => {}); await browser?.close().catch(() => {}); await ownedRuntime?.dispose().catch(() => {});
    }
  }
  browser = await chromium.launch({ headless: true, env: browserEnv });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
  return { browser, context, driver: null, ownedRuntime: null, capability, headless: true };
}

/** Canonical completed source, not a made-up successful reply after a stream error. */
export function parseV2NativeResponse(bytes, contentType, decision) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 1048576) throw new ProbeFailure('RESPONSE_BOUND');
  const text = bytes.toString('utf8');
  if (/application\/x-ndjson/i.test(contentType ?? '')) {
    if (decision.kind !== 'v2-research-write') throw new ProbeFailure('V2_NATIVE_STREAM_SCOPE_REJECTED');
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (!lines.length || lines.length > 2048) throw new ProbeFailure('V2_NATIVE_STREAM_BOUND');
    let events; try { events = lines.map(line => JSON.parse(line)); } catch { throw new ProbeFailure('V2_NATIVE_STREAM_INVALID'); }
    const terminal = events.filter(row => row?.type === 'completed' || row?.type === 'failed');
    if (terminal.length !== 1 || terminal[0] !== events.at(-1)) throw new ProbeFailure('V2_NATIVE_STREAM_COMPLETION_REQUIRED');
    if (terminal[0].type === 'failed') throw new ProbeFailure('V2_NATIVE_STREAM_FAILED');
    if (!terminal[0].source || typeof terminal[0].source !== 'object' || Array.isArray(terminal[0].source)) throw new ProbeFailure('V2_NATIVE_STREAM_SOURCE_REQUIRED');
    return terminal[0].source;
  }
  try { return JSON.parse(text); } catch { throw new ProbeFailure('RESPONSE_SCHEMA_INVALID'); }
}

/** Copy only explicit, verified files from this attempt's private native-print directory. */
export async function storeV2PrintFiles({ result, ownedRuntime, outputDirectory, assertSafe, verifyImage, budget }) {
  if (!ownedRuntime?.available || !result?.metadata || !Buffer.isBuffer(result.bytes) || typeof assertSafe !== 'function' || typeof verifyImage !== 'function') throw new ProbeFailure('V2_PRINT_FILES_SCOPE_INVALID');
  const input = realpathSync(ownedRuntime.outputDirectory), output = realpathSync(outputDirectory);
  for (const path of [input, output]) { const info = lstatSync(path); if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new ProbeFailure('V2_PRINT_FILES_SCOPE_INVALID'); }
  const metadata = result.metadata;
  if (metadata.filename?.includes('/') || metadata.filename?.includes('\\') || !metadata.filename?.endsWith('.pdf') || metadata.sha256 !== createHash('sha256').update(result.bytes).digest('hex')) throw new ProbeFailure('V2_PRINT_FILE_HASH_MISMATCH');
  const filenames = [metadata.filename, ...(result.screens ?? []), ...(metadata.pages ?? []).map(row => row.renderFilename)];
  if (filenames.length < 4 || filenames.length > 103 || new Set(filenames).size !== filenames.length) throw new ProbeFailure('V2_PRINT_FILE_SET_BOUND');
  const prepared = [];
  for (const filename of filenames) {
    if (!/^[a-z0-9][a-z0-9.-]{0,179}$/.test(filename ?? '') || !/\.(pdf|png)$/.test(filename)) throw new ProbeFailure('V2_PRINT_FILE_NAME_REJECTED');
    const path = resolve(input, filename), info = lstatSync(path);
    if (realpathSync(path) !== path || !info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || info.size < 512 || info.size > (filename.endsWith('.pdf') ? 33554432 : 8388608)) throw new ProbeFailure('V2_PRINT_FILE_BOUND');
    const bytes = readFileSync(path), hash = createHash('sha256').update(bytes).digest('hex');
    if (filename === metadata.filename && (!bytes.equals(result.bytes) || hash !== metadata.sha256)) throw new ProbeFailure('V2_PRINT_FILE_HASH_MISMATCH');
    await assertSafe(filename); prepared.push({ filename, bytes, sha256: hash });
  }
  const pdfBytes = prepared.filter(row => row.filename.endsWith('.pdf')).reduce((n, row) => n + row.bytes.length, 0);
  const renderBytes = prepared.filter(row => row.filename.endsWith('.png')).reduce((n, row) => n + row.bytes.length, 0);
  if (budget && (!Number.isSafeInteger(budget.pdfRemainingBytes) || budget.pdfRemainingBytes < 0 || budget.pdfRemainingBytes > 536870912
      || !Number.isSafeInteger(budget.renderRemainingBytes) || budget.renderRemainingBytes < 0 || budget.renderRemainingBytes > 1073741824)) throw new ProbeFailure('V2_PRINT_RUN_BYTE_BUDGET_INVALID');
  if (pdfBytes > (budget?.pdfRemainingBytes ?? 536870912) || renderBytes > (budget?.renderRemainingBytes ?? 1073741824)) throw new ProbeFailure('V2_PRINT_RUN_BYTE_BOUND');
  const files = [];
  // Validate the complete explicit set before creating any public artifact file.
  for (const row of prepared) {
    const dimensions = row.filename.endsWith('.png') ? await verifyImage(row.bytes) : {};
    files.push({ filename: row.filename, bytes: row.bytes.length, sha256: row.sha256, ...dimensions });
  }
  for (const row of prepared) writeFileSync(resolve(output, row.filename), row.bytes, { flag: 'wx', mode: 0o600 });
  return { filename: metadata.filename, files, bytes: result.bytes.length, sha256: metadata.sha256, pdfBytes, renderBytes };
}

/** This is the reviewed operation vocabulary, never a request URL-based permission fallback. */
export function v2NativeOperationInput(input, plan) {
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['operationId','kind','stage','stageId','entityRole','entityId','resourceId','requestKind','expectedFields','perform'].includes(key))
      || typeof input.perform !== 'function' || input.stage !== undefined && input.stageId !== undefined && input.stage !== input.stageId) throw new ProbeFailure('V2_NATIVE_OPERATION_INPUT_INVALID');
  const row = plan.operations.find(item => item.id === input.operationId), stageId = input.stageId ?? input.stage;
  if (!row || row.kind !== input.kind || row.stage !== stageId || row.entityRole !== input.entityRole) throw new ProbeFailure('V2_NATIVE_OPERATION_NOT_PLANNED');
  const vocabulary = {
    's6-test-survey-markdown-proposal': 'survey-proposal', 's6-test-survey-native-create': 'survey-create',
    's6-test-survey-native-report':'survey-report','s6-test-survey-native-publish': 'survey-publish', ...Object.fromEntries(Array.from({length:8},(_,index)=>[`s6-test-survey-native-participant-submit-${String(index+1).padStart(2,'0')}`,'survey-submit'])),
    's6-test-virtual-native-create': 'research-create', 's6-test-virtual-native-initialize': 'research-initialize',
    's6-test-virtual-native-save-intake': 'research-save', 's6-test-virtual-native-confirm-analysis': 'research-confirm',
    's6-test-virtual-native-save-outline': 'research-save', 's6-test-virtual-analysis': 'research-generate',
    's6-test-virtual-outline': 'research-generate', 's6-test-virtual-runs': 'research-execute', 's6-test-virtual-report': 'research-generate',
    's5-prototype-single-image-generate': 'design-image', 's5-prototype-three-image-generate': 'design-image', 's5-prototype-three-html-generate': 'design-generate',
    's5-prototype-three-webapp-generate': 'design-generate', 's6-test-offline-iterate-prototype': 'design-generate',
    's2-source-interview-chat-audio-upload':'chat-audio-upload','s6-test-offline-chat-audio-upload':'chat-audio-upload', 's2-source-interview-file-asr': 'asr-file', 's6-test-offline-file-asr': 'asr-file',
  };
  const requestKind = vocabulary[input.operationId];
  if (!requestKind || input.requestKind !== undefined && input.requestKind !== requestKind) throw new ProbeFailure('V2_NATIVE_OPERATION_KIND_NOT_CLOSED');
  return { operationId: row.id, kind: row.kind, requestKind, stageId, entityRole: row.entityRole,
    ...(input.entityId ? { entityId: input.entityId } : {}), ...(input.resourceId ? { resourceId: input.resourceId } : {}),
    ...(input.expectedFields ? { expectedFields: input.expectedFields } : {}) };
}

export function candidateDialogLocator(page, profile, currentUrl, projectId, stageId) {
  const url = new URL(currentUrl);
  if (profile !== V2_VOICE_PROFILE || url.origin !== ORIGIN || url.pathname !== `/aidt/${projectId}` || url.searchParams.get('step') !== String(stageId)
      || stageId !== 3 || !['persona','hmw'].includes(url.searchParams.get('candidate'))) throw new ProbeFailure('V2_CANDIDATE_DIALOG_SCOPE_REJECTED');
  return page.getByRole('dialog', { name: url.searchParams.get('candidate') === 'persona' ? '从证据形成画像' : '找到值得继续探索的问题', exact: true });
}

export async function main() {
  // These variables can expose Playwright fill arguments; remove before importing its API.
  for (const key of ['DEBUG', 'PWDEBUG', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'NODE_OPTIONS']) delete process.env[key];
  const report = { kind: 'devapp-aidt-ui-acceptance-v1', target: ORIGIN, passed: false, syntheticData: true,
    classroomValidated: false, realModelVerified: false, crossUserIsolationVerified: false,
    projectCatalogScope: 'native organization project list restricted in the synthetic browser to the current run-owned project',
    controlSource: null, deployedRuntime: null, deploymentLockHeld: false, runtimeRechecks: 0,
    checkpoints: [], screenshots: [], pendingTeachingReviews: [], scope: 'writes and screenshots: new owned QA project only',
    authorizedMetadataReads: 'Native clients also read the QA-authorized identity, course/project/Skill/Agent catalogs and Design list in memory. Closed read-category counters count guard decisions; bounded metadata HTTP statuses come only from observed responses. No raw lists, URLs, queries, headers, bodies or unrelated projects are exported.',
    designRequestLimit: 'At most one normal UI Design chat request; default page count is decided by the existing service, not capped to one page.' };
  let browser, context, page, output, identity, guard, credentials, provisionedIdentity, timer, agentReviewer, stage = 'preflight';
  let profile, plan, ledger, v2Scope, nativeDriver, nativeRuntime, actionWindow, asrReviewer;
  const runtimeScope = () => { if (!v2Scope) throw new ProbeFailure('V2_RUNTIME_SCOPE_UNVERIFIED'); return { ...v2Scope }; };
  const sensitiveEvidence = sensitiveEvidenceGuard();
  try {
    if (process.argv.length !== 2) throw new ProbeFailure('ARGUMENTS_REJECTED');
    assertAcceptanceWorkflow(process.env);
    profile = acceptanceProfile(process.env);
    report.acceptanceProfile = profile;
    if (profile === V2_VOICE_PROFILE) { plan = createV2VoicePlan(); report.nativePrintBudget = { pdfMaximumBytes: 536870912, renderMaximumBytes: 1073741824, pdfBytes: 0, renderBytes: 0, plannedFiles: plan.limits.nativePdfFiles, exhausted: false, byStage: {} }; report.kind = 'devapp-aidt-v2-voice-acceptance-v1';report.designRequestLimit='Closed V2 manifest: actual named HTML, WebApp and post-test iteration only; no unknown-result retry.'; report.v2Plan = { manifestSha256: plan.manifestSha256, limits: plan.limits, formalOutputs: plan.formalOutputs, caseIds: plan.caseIds }; }
    identity = acceptanceIdentity(process.env);
    identity.controlSource = process.env.GITHUB_SHA;
    const agentQaRequested = agentQaReviewRequested(process.env, identity);
    // A full writer may not spend an account or model call before its actual reviewer channel is ready.
    if (!identity.entryDiagnosticOnly && !agentQaRequested) throw new ProbeFailure('S1_I3_STUDENT_RESPONSE_REVIEW_REQUIRED');
    const provisionOrdinaryQa = ordinaryQaProvisioningRequested(process.env, identity);
    const reusableCredentials = consumeReusableQaCredentials(process.env);
    const configuredBinding = process.env.AIDT_REUSABLE_QA_IDENTITY_SHA256;
    if (reusableCredentials && (provisionOrdinaryQa ? Boolean(configuredBinding) : !/^[a-f0-9]{64}$/.test(configuredBinding ?? ''))) {
      throw new ProbeFailure('QA_REUSABLE_IDENTITY_CONFIGURATION_INVALID');
    }
    if (reusableCredentials) {
      sensitiveEvidence.remember(reusableCredentials.email);
      sensitiveEvidence.remember(reusableCredentials.password);
      report.qaCredentialSource = 'protected-devapp-environment';
    }
    if (provisionOrdinaryQa) report.scope = 'Setup: one dedicated synthetic consultant account through one bounded organization invitation lifecycle. Student business writes and screenshots: new owned QA project only; setup counts are separate.';
    report.controlSource = process.env.GITHUB_SHA;
    report.executionMode = identity.entryDiagnosticOnly ? 'entry-diagnostic-readonly' : 'agent-operated-software-qa';
    report.fullAcceptancePassed = false;
    report.requirements = { source: 'docs/requirements/aidt-v2-full.md', declaredVersion: 'V2 with 2026-11-15 FR15-FR19' };
    report.stageIterations = [];
    report.systemArtifacts = [];
    report.teachingEvidence = [];
    report.budgets = { homepageMinutes: 20, stageMinutes: 15, stage5Minutes: 20, overallMinutes: 142, stage5Reason: 'Existing Design request can take up to 900 seconds; allow native Chat and normal UI save/review overhead without unknown-write retry.' };
    if (profile === V2_VOICE_PROFILE) {
      // Independent finite wall-clock cap agreed for this profile; per-case bounds remain separate.
      report.budgets = { profile, overallMinutes: 360, caseDeadlinesMs: Object.fromEntries(plan.caseBindings.map(item => [item.caseId, item.timeoutMs])) };
    }
    const overallDeadline = Date.now() + report.budgets.overallMinutes * 60 * 1000;
    report.independentPdfValidation = 'pending artifact download and independent parser/renderer; byte generation is not complete glyph acceptance';
    output = privateOutput(process.env, identity);
    const metadata = JSON.parse(readFileSync(new URL('../../../../acceptance-source.json', import.meta.url), 'utf8'));
    if (metadata.controlSource !== process.env.GITHUB_SHA || !Array.isArray(metadata.teachingSkillNames) || metadata.teachingSkillNames.length < 6) throw new ProbeFailure('SOURCE_BUNDLE_INVALID');
    identity.teachingSkillNames = metadata.teachingSkillNames;
    if (profile === V2_VOICE_PROFILE && (!metadata.candidateActions || metadata.profile !== profile || metadata.planManifestSha256 !== plan.manifestSha256)) throw new ProbeFailure('V2_SOURCE_BUNDLE_PROFILE_MISMATCH');
    identity.deniedProject = `prj-${randomUUID()}`;
    report.deployedRuntime = runtimeProof(identity);
    if (agentQaRequested) {
      agentReviewer = createAgentQaReviewer({ identity, controlSource: process.env.GITHUB_SHA,
        out: output.out, assertSafe: text => sensitiveEvidence.assertSafe(text), deadlineAt: overallDeadline });
      await agentReviewer.preflight();
      report.agentReview = agentReviewer.summary();
      const afterReviewPreflight = runtimeProof(identity);
      if (JSON.stringify(afterReviewPreflight) !== JSON.stringify(report.deployedRuntime)) throw new ProbeFailure('RUNTIME_CHANGED_DURING_ACCEPTANCE');
      report.runtimeRechecks++;
    }
    if(profile===V2_VOICE_PROFILE){
      const audio=readV2SyntheticAudioFixture(metadata,identity),source=metadata.syntheticAudioFixture.groundtruth,path='apps/web/e2e/fixtures/aidt-v2/synthetic-prototype-test.txt';
      if(source?.path!==path||!Number.isSafeInteger(source.bytes)||source.bytes<10||source.bytes>16384||!/^[a-f0-9]{64}$/.test(source.sha256??''))throw new ProbeFailure('V2_SYNTHETIC_GROUNDTRUTH_METADATA_INVALID');
      const info=lstatSync(path),bytes=readFileSync(path);if(!info.isFile()||info.isSymbolicLink()||bytes.length!==source.bytes||createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw new ProbeFailure('V2_SYNTHETIC_GROUNDTRUTH_BYTES_CHANGED');
      const {createV2AsrReviewer}=await import('./devapp-aidt-v2-asr-review.mjs');
      asrReviewer=createV2AsrReviewer({identity,controlSource:process.env.GITHUB_SHA,out:output.out,assertSafe:text=>sensitiveEvidence.assertSafe(text),deadlineAt:overallDeadline,fixture:{sourceSha256:metadata.syntheticAudioFixture.sha256,bytes:audio.bytes.length,groundtruth:bytes.toString('utf8'),groundtruthSha256:source.sha256}});
      report.asrReviewCapability=await asrReviewer.preflight();report.asrReview=asrReviewer.summary();
    }
    const { chromium, expect, request } = await import('@playwright/test');
    const browserEnv = Object.fromEntries(['PATH', 'HOME', 'LANG', 'TZ', 'PLAYWRIGHT_BROWSERS_PATH'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    if (profile === V2_VOICE_PROFILE) {
      // No account read/bootstrap, login or model exists before the actual owned print capability probe.
      const prepared = await prepareV2Browser({ chromium, outputRoot: output.out, assertSafe: text => sensitiveEvidence.assertSafe(text), browserEnv });
      ({ browser, context } = prepared); nativeDriver = prepared.driver; nativeRuntime = prepared.ownedRuntime;
      report.nativePrintCapability = prepared.capability; report.browser = { name: 'Chromium', version: browser.version(), playwrightVersion: metadata.playwrightVersion, headless: prepared.headless };
    }
    credentials = reusableCredentials && !provisionOrdinaryQa ? reusableCredentials : readQaCredentials();
    sensitiveEvidence.remember(credentials.email); sensitiveEvidence.remember(credentials.password);
    if (provisionOrdinaryQa) {
      stage = 'ordinary-qa-bootstrap';
      const { bootstrapOrdinaryQaIdentity } = await import('./devapp-aidt-qa-identity.mjs');
      const setupStartedUTC = new Date().toISOString(), setupTick = performance.now();
      try {
        const created = await bootstrapOrdinaryQaIdentity({ origin: ORIGIN, adminCredentials: credentials, reusableCredentials: reusableCredentials ?? undefined,
          createContext: options => request.newContext(options),
          onSecret: value => sensitiveEvidence.remember(value),
          onReceipt: receipt => { report.qaProvisioning = receipt; },
        });
        // Setup identities never enter the browser or the exported report. The
        // new student must independently authenticate through the normal UI.
        provisionedIdentity = created.identity; credentials = created.credentials;
        sensitiveEvidence.remember(credentials.email); sensitiveEvidence.remember(credentials.password);
        report.qaProvisioning = created.receipt;
        report.provisionedUiIdentityVerified = false;
      } finally {
        report.qaProvisioningTiming = { owner: 'root/aidt_atomic_backend', startedUTC: setupStartedUTC,
          finishedUTC: new Date().toISOString(), durationMs: Math.round(performance.now() - setupTick) };
      }
    }
    guard = profile === V2_VOICE_PROFILE ? createV2AcceptanceGuard(identity, { plan, ledger: () => ledger, runtimeScope: () => v2Scope }) : createAcceptanceGuard(identity);
    if(profile===V2_VOICE_PROFILE)actionWindow=createV2ActionWindow({guard,plan,runtimeScope});
    const remainingMs = overallDeadline - Date.now();
    if (remainingMs <= 0) throw new ProbeFailure('ACCEPTANCE_TIMEOUT');
    timer = setTimeout(() => { guard.fail('ACCEPTANCE_TIMEOUT'); void context?.close(); }, remainingMs);
    if (profile !== V2_VOICE_PROFILE) {
      browser = await chromium.launch({ headless: true, env: browserEnv });
      report.browser = { name: 'Chromium', version: browser.version(), playwrightVersion: metadata.playwrightVersion, headless: true };
      context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
    }
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
            const audioUpload=profile===V2_VOICE_PROFILE&&/^\/api\/chat\/threads\/[^/]+\/attachments$/.test(new URL(request.url()).pathname);
            const stageTextUpload = profile !== V2_VOICE_PROFILE
              && /^\/api\/chat\/threads\/[^/]+\/attachments$/.test(new URL(request.url()).pathname);
            const sourceImageUpload=profile===V2_VOICE_PROFILE&&/^\/api\/pm-designs\/[^/]+\/ref-images$/.test(new URL(request.url()).pathname);
            if ([...form.keys()].sort().join(',') !== ((audioUpload || stageTextUpload)?'file':sourceImageUpload?'contentType,file':'files,meta')) throw new ProbeFailure('UPLOAD_FORM_REJECTED');
            const file = form.get(audioUpload || sourceImageUpload || stageTextUpload ? 'file' : 'files');
            if (typeof file === 'string' || !file || file.size > 262144) throw new ProbeFailure('UPLOAD_FORM_REJECTED');
            const bytes = Buffer.from(await file.arrayBuffer());
            const files=[{ filename:file.name,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mime:file.type }];
            if(audioUpload){if(!['audio/wav','audio/x-wav','audio/mpeg'].includes(file.type))throw new ProbeFailure('UPLOAD_FORM_REJECTED');body={__multipart:true,fields:{},files};}
            else if (stageTextUpload) {
              if (file.type !== 'text/plain') throw new ProbeFailure('UPLOAD_FORM_REJECTED');
              body = { __multipart: true, files };
            }
            else if(sourceImageUpload){if(!['image/png','image/jpeg','image/webp'].includes(file.type)||form.get('contentType')!==file.type)throw new ProbeFailure('UPLOAD_FORM_REJECTED');body={__multipart:true,fields:{contentType:file.type},files};}
            else {let meta;try{meta=JSON.parse(form.get('meta'));}catch{throw new ProbeFailure('UPLOAD_FORM_REJECTED');}body={__multipart:true,meta,files};}
          } else { try { body = request.postDataJSON(); } catch { throw new ProbeFailure('REQUEST_BODY_UNSUPPORTED'); } }
        }
        const descriptor = { url: request.url(), method: request.method(), body, resourceType: request.resourceType() };
        const actionWindowArmed=profile===V2_VOICE_PROFILE&&actionWindow?.matchesNext(descriptor)?actionWindow.armForRequest(descriptor):false;
        let decision = guard.decide(descriptor);
        if (!decision.allow && decision.kind === 'teaching-run-needs-binding') {
          // Never trust a run ID from SSE. Reread only the armed owned thread,
          // then let canonical human-message observation establish the run link.
          for (const path of guard.teachingReadsToBind()) await api(page, 'GET', path);
          decision = guard.decide(descriptor);
        }
        if (!decision.allow) return await route.abort('blockedbyclient');
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: decision.kind === 'design-generation' ? 900000 : decision.kind === 'teaching-turn' ? 300000 : 30000 });
        await enforceDeniedProbeStatus(decision, response);
        if (response.status() >= 300 && response.status() < 400) throw new ProbeFailure('REDIRECT_REJECTED');
        let parsed;
        if (['upload-content', 'qa-stage-text-content'].includes(decision.kind) || profile===V2_VOICE_PROFILE&&['v2-native-audio-content','v2-native-artifact-content'].includes(decision.kind)) {
          const bytes = await response.body();
          if (bytes.length > 262144) throw new ProbeFailure('RESPONSE_BOUND');
          guard.observeContent(decision, response.status(), response.headers(), bytes);
        } else if (!['read', 'denied-probe', 'aidt-tag', 'mount-owned-thread', 'teaching-turn'].includes(decision.kind)
          && (decision.kind !== 'qa-project-catalog' || response.status() === 200)) {
          const bytes = await response.body();
          if (bytes.length > 1048576) throw new ProbeFailure('RESPONSE_BOUND');
          if (profile === V2_VOICE_PROFILE) parsed = parseV2NativeResponse(bytes, response.headers()['content-type'], decision);
          else { try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new ProbeFailure('RESPONSE_SCHEMA_INVALID'); } }
        }
        if (decision.kind === 'login' && typeof parsed?.sessionToken === 'string') sensitiveEvidence.remember(parsed.sessionToken);
        if (decision.kind === 'survey-publish' && typeof parsed?.publication?.token === 'string') sensitiveEvidence.remember(parsed.publication.token);
        guard.observe(decision, response.status(), parsed);
        if(actionWindowArmed)actionWindow.observeResponse(descriptor,response.status(),parsed);
        // Bind only the actual created candidate before the normal UI resumes.
        if (decision.kind === 'create-project' && [200, 201].includes(response.status())) {
          const id = guard.identity().candidate;
          const overview = await api(page, 'GET', `/api/projects/${id}/overview`);
          const membership = await api(page, 'GET', `/api/projects/${id}/collaborators`);
          if (overview.status !== 200 || membership.status !== 200) throw new ProbeFailure('QA_PROJECT_OWNERSHIP_READ_FAILED');
          guard.bindOwnedProject(overview.data, membership.data?.members);
          if (profile === V2_VOICE_PROFILE) {
            const owned = guard.identity();
            v2Scope = { source: identity.source, controlSource: process.env.GITHUB_SHA, tag: identity.tag, run: identity.run, attempt: identity.attempt, orgId: owned.org, actorId: owned.actor, orgRole: 'consultant', projectId: owned.projectId };
            ledger = createV2ExecutionLedger(plan, v2Scope);
          }
        }
        if (decision.kind === 'qa-project-catalog' && response.status() === 200) {
          // The native homepage fetches each listed roster as one batch. Keep the
          // actual current project row while preventing requests for other projects.
          const headers = response.headers();
          for (const name of ['content-length', 'content-encoding', 'etag']) delete headers[name];
          headers['cache-control'] = 'no-store';
          await route.fulfill({ response, headers, json: visibleAidtQaProjects(parsed, decision.projectId) });
        } else {
          await route.fulfill({ response });
        }
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
    let pendingReviewCapture = null;
    const capture = async (name, expectedStage, region = 'workspace', pendingReceipt) => {
      const screenshotName = profile === V2_VOICE_PROFILE ? /^[A-Za-z0-9][A-Za-z0-9-]{0,85}$/ : /^[a-z0-9][a-z0-9-]{0,85}$/;
      if (!screenshotName.test(name)) throw new ProbeFailure('SCREENSHOT_NAME_INVALID');
      if (region === 'workspace' || region === 'owned-tool-review' || region === 'card-dialog' || region === 'candidate-dialog') assertCaptureScope(page.url(), guard.identity().projectId, expectedStage);
      else { const url = new URL(page.url()); if (url.origin !== ORIGIN || url.pathname !== '/aidt' || !['home-create-actions', 'create-dialog'].includes(region)) throw new ProbeFailure('SCREENSHOT_SCOPE_REJECTED'); }
      if (region === 'owned-tool-review') {
        if (!pendingReviewCapture || pendingReviewCapture.receipt !== pendingReceipt || pendingReceipt.stageId !== expectedStage) throw new ProbeFailure('TOOL_REVIEW_SCOPE_UNVERIFIED');
        const { scope } = pendingReviewCapture;
        pendingTeachingReviewReceipt(pendingReceipt, scope, page.url(), guard.teachingPin(scope.stageId, scope.threadId, scope.selector.entityId));
        if (await page.getByTestId('aidt-project-workspace').getByTestId('restored-run-approval').count() !== 1 || await page.getByTestId('chat-tool-permission-dialog').count() !== 1) throw new ProbeFailure('TOOL_REVIEW_DIALOG_NOT_UNIQUE');
      }
      if (region === 'card-dialog') {
        const url = new URL(page.url());
        const dialog = page.getByRole('dialog');
        if (url.searchParams.has('entity') || await dialog.count() !== 1 || !await aidtCreateTagInput(dialog, expectedStage).isVisible()) throw new ProbeFailure('CARD_DIALOG_SCOPE_UNVERIFIED');
      }
      let candidate;
      if (region === 'candidate-dialog') { candidate = candidateDialogLocator(page, profile, page.url(), guard.identity().projectId, expectedStage); if (await candidate.count() !== 1 || await page.getByRole('dialog').count() !== 1) throw new ProbeFailure('V2_CANDIDATE_DIALOG_NOT_UNIQUE'); }
      recheckRuntime();
      const workspace = candidate ?? (region === 'card-dialog' ? page.getByRole('dialog') : region === 'owned-tool-review' ? page.getByTestId('chat-tool-permission-dialog') : region === 'workspace' ? page.getByTestId('aidt-project-workspace') : region === 'home-create-actions' ? page.getByRole('heading', { name: '我的工作坊', exact: true }).locator('..') : page.getByRole('dialog').filter({ has: page.getByTestId('project-new-details') }));
      await workspace.waitFor({ state: 'visible' });
      // Workspace captures dismiss unrelated overlays; owned review evidence must keep its modal open.
      if (region === 'workspace') await page.keyboard.press('Escape');
      const visibleText = await workspace.evaluate(root => {
        const visible = node => node instanceof HTMLElement && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
        return [root.innerText, ...[...root.querySelectorAll('input,textarea,[contenteditable="true"]')].filter(visible).map(node => 'value' in node ? node.value : node.innerText)].join('\n');
      });
      if (Buffer.byteLength(visibleText) > 1048576) throw new ProbeFailure('SCREENSHOT_CONTENT_BOUND');
      // Keep setup/admin credentials out of the student browser altogether.
      sensitiveEvidence.assertSafe(visibleText);
      const sensitive = await page.evaluate(values => {
        const token = localStorage.getItem('wsx.sessionToken');
        return Boolean(token && values.includes(token)) || /Bearer\s+[A-Za-z0-9._~-]{12,}|\bsk-[A-Za-z0-9]{16,}/.test(values);
      }, visibleText);
      if (sensitive) throw new ProbeFailure('SCREENSHOT_SENSITIVE_CONTENT');
      const bytes = await workspace.screenshot({ type: 'png', animations: 'disabled' });
      const dimensions = await verifyPng(browser, bytes, ['workspace','owned-tool-review','candidate-dialog'].includes(region) ? 200 : 24), filename = `${name}.png`;
      writeFileSync(resolve(output.out, filename), bytes, { flag: 'wx', mode: 0o600 });
      const receipt = { filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...dimensions, stage: expectedStage ?? null, region };
      report.screenshots.push(receipt); return receipt;
    };
    const checkpoint = async (name, operation) => {
      if (!/^[a-z0-9][a-z0-9-]{0,90}$/.test(name)) throw new ProbeFailure('CHECKPOINT_NAME_INVALID');
      if (guard.fatal()) { report.checkpoints.push({ name, status: 'blocked', code: guard.fatal() }); return false; }
      const startedUTC = new Date().toISOString(), tick = performance.now(), maximumMinutes = name === 's5-prototype-question-version' || name === 'homepage-ui-create-persist' ? 20 : 15;
      console.log(JSON.stringify({ event: 'checkpoint-start', name, startedUTC, maximumMinutes }));
      const record = result => { const durationMs = Math.round(performance.now() - tick); const item = { name, ...result, owner: 'root/aidt_ui_first_acceptance', startedUTC, finishedUTC: new Date().toISOString(), durationMs, maximumMinutes, timedOut: durationMs > maximumMinutes * 60000, nextAction: durationMs > maximumMinutes * 60000 ? 'Inspect exact active run and stage evidence before any retry' : null }; if (item.timedOut && item.status === 'passed') item.status = 'timed_out'; report.checkpoints.push(item); console.log(JSON.stringify({ event: 'checkpoint-finish', ...item })); return item; };
      try { recheckRuntime(); await operation(); return record({ status: 'passed' }).status === 'passed'; }
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
    if (provisionedIdentity) { assertProvisionedOrdinaryQa(provisionedIdentity, guard.identity(), me.status, me.data); report.provisionedUiIdentityVerified = true; }
    if (reusableCredentials && (!report.actor.ordinaryConsultant || me.data?.org?.kind !== 'organization')) {
      throw new ProbeFailure('ORDINARY_QA_CONSULTANT_REQUIRED');
    }
    if (reusableCredentials) {
      const fingerprint = reusableQaIdentityFingerprint(guard.identity(), configuredBinding, provisionOrdinaryQa);
      if (provisionedIdentity) report.qaEnrollmentFingerprint = fingerprint;
      report.reusableQaUiIdentityVerified = true;
    }
    if (identity.entryDiagnosticOnly) {
      report.kind = 'devapp-aidt-entry-diagnostic-v1';
      const visible = await page.getByTestId('aidt-new').isVisible();
      await capture('00-home-create-actions', undefined, 'home-create-actions');
      report.entryDiagnostic = { completed: true, orgRole: report.actor.orgRole, creationEntryVisible: visible,
        ordinaryQaSuitable: report.actor.ordinaryConsultant, missingEntryReproduced: report.actor.ordinaryConsultant && !visible,
        projectWrites: 0, writesOtherThanLogin: 0, scope: provisionOrdinaryQa ? 'one invitation setup, followed by read-only project home' : 'read-only entry observation; not creation or six-stage acceptance' };
      report.passed = true;
      return;
    }
    guard.verifyOrdinaryIdentity(me.status, me.data);
    // ENTRY-01 is the first checkpoint in this writer; preserve this same context for S1.
    const entryClock = createEntryClock(), entryObservations = [], entryScreenshots = [];
    let entryTiming;
    const homeCreated = await checkpoint('homepage-ui-create-persist', async () => {
      await capture('00-home-create-actions', undefined, 'home-create-actions');
      await expect(page.getByTestId('aidt-new')).toBeVisible(); await page.getByTestId('aidt-new').click();
      await page.getByTestId('project-new-name').fill(identity.projectName);
      const courseTag = `QA课程 ${identity.run}-${identity.attempt}`;
      await page.getByLabel('课程标签（可选）', { exact: true }).fill(courseTag);
      await capture('00-create-dialog', undefined, 'create-dialog');
      entryClock.check(); guard.armProjectCreate(courseTag); await page.getByTestId('project-new-create').click();
      await expect.poll(() => guard.identity().projectId).toMatch(/^prj-/);
      const id = guard.identity().projectId;
      await page.waitForURL(`${ORIGIN}/aidt/${id}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('aidt-dashboard')).toBeVisible();
      for (let n = 1; n <= 6; n++) await expect(page.getByTestId(`aidt-step-${n}`)).toBeVisible();
      report.project = { id, name: identity.projectName, ownerVerified: true, profile: 'aidt', setup: 'normal-homepage-UI', ordinaryConsultant: true };
      entryObservations.push(await verifyEntryWorkspace({ page, expect, origin: ORIGIN, projectId: id, clock: entryClock }));
      entryScreenshots.push(await capture('00-created-six-stage-overview'));
      await page.goto(`${ORIGIN}/aidt`); await expect(page.getByTestId(`aidt-project-${id}`)).toBeVisible();
      entryClock.check(); await page.reload();
      const card = page.getByTestId(`aidt-project-${id}`);
      await expect(card).toBeVisible();
      await expect(card.getByText(courseTag, { exact: true })).toBeVisible();
      const courseFilter = page.getByRole('combobox', { name: '按课程筛选', exact: true });
      await courseFilter.selectOption('untagged');
      await expect(card).toHaveCount(0);
      await courseFilter.selectOption({ label: courseTag });
      await expect(card).toBeVisible();
      await courseFilter.selectOption('');
      await expect(card).toBeVisible();
      report.courseTag = { savedAfterReload: true, hiddenByUntaggedFilter: true, visibleByMatchingFilter: true };
      entryClock.check(); await card.click();
      await page.waitForURL(`${ORIGIN}/aidt/${id}`, { waitUntil: 'domcontentloaded' });
      entryObservations.push(await verifyEntryWorkspace({ page, expect, origin: ORIGIN, projectId: id, clock: entryClock }));
      entryScreenshots.push(await capture('00-created-reentry-overview'));
      entryTiming = entryClock.complete();
    });
    if (!homeCreated) {
      report.entry01 = entryClock.failed(report.checkpoints.at(-1)?.code);
      throw new ProbeFailure('HOMEPAGE_UI_CREATION_NOT_ACCEPTED');
    }
    const projectId = guard.identity().projectId;
    recheckRuntime();
    // A separate, exactly-once artifact: no H03 nonce/request capacity or credential serialization.
    // An unknown artifact result is recorded without replay; the same student session continues.
    report.entry01 = { status: 'PASSED', projectId, timing: entryTiming };
    try {
      const publisher = createEntryPublisher({ identity, out: output.out, assertSafe: text => sensitiveEvidence.assertSafe(text) });
      const proof = await publisher.publish({ projectId, ordinaryRole: report.actor.orgRole, timing: entryTiming, observations: entryObservations, screenshots: entryScreenshots });
      report.entry01 = proof.receipt; report.entry01Delivery = proof.delivery;
    } catch (error) {
      report.entry01Delivery = { status: 'BLOCKED', code: safeCode(error), attempted: false, retryAllowed: false };
    }
    console.log(JSON.stringify({ event: 'entry-01-proof', projectId, status: report.entry01.status, delivery: report.entry01Delivery }));
    const saveStage = async (n, visibleButton, { confirmation = false } = {}) => {
      const button = visibleButton ?? page.getByTestId('aidt-shared-save');
      await expect(button).toBeVisible(); await expect(button).toBeEnabled();
      guard.armStageSave(n, confirmation);
      const [response] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === `/api/projects/${projectId}/aidt/stages/${n}` && response.request().method() === 'PUT', { timeout: 30000 }),
        button.click(),
      ]);
      if (response.status() !== 200) throw new ProbeFailure('STAGE_UI_SAVE_NOT_CONFIRMED');
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
    const createSurveyParticipant = async href => {
      if (!href) throw new ProbeFailure('NATIVE_SURVEY_FORM_LINK_MISSING');
      const target = new URL(href, ORIGIN);
      if (!guard.decideSurveyParticipant({ url: target.href, method: 'GET' }).allow || !target.pathname.startsWith('/surveys/'))
        throw new ProbeFailure('NATIVE_SURVEY_FORM_LINK_INVALID');
      const respondent = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      await respondent.route('**/*', async route => {
        const request = route.request();
        try {
          if (request.headers().authorization) throw new ProbeFailure('SURVEY_RESPONDENT_AUTH_PRESENT');
          const body = request.method() === 'POST' ? request.postDataJSON() : undefined;
          const decision = guard.decideSurveyParticipant({ url: request.url(), method: request.method(), body });
          if (!decision.allow) return await route.abort('blockedbyclient');
          const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 });
          if (response.status() >= 300 && response.status() < 400) throw new ProbeFailure('REDIRECT_REJECTED');
          if (decision.kind === 'survey-submit' || profile===V2_VOICE_PROFILE&&decision.kind==='survey-public-read') {
            const bytes = await response.body();
            if (bytes.length > (decision.kind==='survey-public-read'?1048576:4096)) throw new ProbeFailure('RESPONSE_BOUND');
            guard.observe(decision, response.status(), JSON.parse(bytes.toString('utf8')));
          }
          await route.fulfill({ response });
        } catch (error) { guard.fail(safeCode(error)); try { await route.abort('blockedbyclient'); } catch { /* Already closed. */ } }
      });
      await respondent.routeWebSocket('**/*', socket => socket.close());
      try {
        const page = await respondent.newPage();
        await page.goto(target.href);
        return { page, close: () => respondent.close() };
      } catch (error) {
        await respondent.close();
        throw error;
      }
    };
    const saveDownload = async download => {
      const path = await download.path();
      if (!path || !download.suggestedFilename().endsWith('.md')) throw new ProbeFailure('REPORT_DOWNLOAD_INVALID');
      const info = lstatSync(path); if (!info.isFile() || info.size < 80 || info.size > 1048576) throw new ProbeFailure('REPORT_DOWNLOAD_INVALID');
      const bytes = readFileSync(path), text = bytes.toString('utf8');
      sensitiveEvidence.assertSafe(text);
      const leakedToken = await page.evaluate(text => { const token = localStorage.getItem('wsx.sessionToken'); return Boolean(token && text.includes(token)); }, text);
      if (leakedToken || !text.includes('合成') || /Bearer\s+[A-Za-z0-9._~-]{12,}|\bsk-[A-Za-z0-9]{16,}/.test(text)) throw new ProbeFailure('REPORT_DOWNLOAD_SENSITIVE');
      const filename = `qa-report-${identity.run}.md`;
      writeFileSync(resolve(output.out, filename), bytes, { flag: 'wx', mode: 0o600 });
      report.download = { filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), humanReadableUtf8: true };
      return report.download;
    };
    const teachingFeedback = async (stageId, prompt, interviewCode, interviewFinding = false, syntheticProblemFixture = false, testPlan = false) => {
      if (interviewCode !== undefined && (stageId !== 2 || !/^U(?:0[1-9]|10)$/.test(interviewCode))) throw new ProbeFailure('INTERVIEW_CODE_UNEXPECTED');
      if (interviewFinding && (stageId !== 2 || !interviewCode)) throw new ProbeFailure('INTERVIEW_CODE_UNEXPECTED');
      const problemRevision = !syntheticProblemFixture && stageId === 1 && report.teachingEvidence.some(item => item.status === 'passed' && item.stageId === 1);
      const interviewGuideRevision = stageId === 2 && !interviewFinding && report.teachingEvidence.some(item => item.status === 'passed' && item.interviewCode === interviewCode);
      const codeSuffix = interviewCode && interviewCode !== 'U01' ? `-${interviewCode.toLowerCase()}` : '';
      const suffix = syntheticProblemFixture ? '-fixture' : problemRevision ? '-revision' : codeSuffix + (interviewFinding ? '-finding' : interviewGuideRevision ? '-revision' : '');
      const definitionTurn = stageId === 3 ? report.teachingEvidence.filter(item => item.stageId === 3 && item.status === 'passed').length : 0;
      const summary = stageId === 6 && new URL(page.url()).searchParams.get('summary') === '1';
      const brainstormTurn = stageId === 4 && report.teachingEvidence.some(item => item.stageId === 4 && item.status === 'passed') ? '-reverse' : '';
      const testTurn = !summary && stageId === 6
        ? (report.teachingEvidence.some(item => item.stageId === 6 && item.entityId !== new URL(page.url()).searchParams.get('entity') && item.status === 'passed') ? '-survey' : '') + (testPlan ? '-plan' : '') : '';
      const threadParam = summary ? 'summaryThread' : 'thread';
      const voiceTurn = report.teachingEvidence.filter(item => item.stageId === stageId && item.status === 'passed').length + 1;
      const name = profile === V2_VOICE_PROFILE && stageId !== 1 && !summary ? `teaching-chat-stage-${stageId}-turn-${voiceTurn}` : summary ? 'teaching-chat-final-report' : `teaching-chat-stage-${stageId}${suffix}${definitionTurn ? '-' + (definitionTurn + 1) : ''}${testTurn}${brainstormTurn}`;
      let isolatedKnownS1Review = false;
      const accepted = await checkpoint(name, async () => {
        if (guard.teachingStopped()) throw new ProbeFailure('TEACHING_PREVIOUS_OUTCOME_UNRESOLVED');
        const url = new URL(page.url());
        await expect.poll(() => new URL(page.url()).searchParams.get(threadParam)).toMatch(/^thr/);
        const entityId = url.searchParams.get('entity');
        await expect.poll(() => { const id = new URL(page.url()).searchParams.get(threadParam); return id && guard.teachingPin(stageId, id, entityId ?? undefined) ? true : false; }, { timeout: 30000 }).toBe(true);
        const threadId = new URL(page.url()).searchParams.get(threadParam);
        const stages = {};
        for (let n = 1; n <= stageId; n++) { const got = await api(page, 'GET', `/api/projects/${projectId}/aidt/stages/${n}`); if (got.status !== 200) throw new ProbeFailure('TEACHING_SOURCE_READ_FAILED'); if (got.data?.stage) stages[n] = got.data.stage; }
        let selector;
        if (summary) {
          if (entityId !== 'group-report') throw new ProbeFailure('REPORT_SCOPE_UNVERIFIED');
          const history = page.getByTestId('aidt-summary-materials').locator('p').filter({ hasText: /^历史选择/ });
          const historyRevisions = [...(await history.textContent()).matchAll(/第(\d+)步 V(\d+)/g)].map(match => ({ stageId: Number(match[1]), revision: Number(match[2]) }));
          selector = { schemaVersion: 1, projectId, purpose: 'summary', ...(profile===V2_VOICE_PROFILE?{entityId:'group-report'}:{}), stageRevisions: Object.values(stages).map(({stageId,revision}) => ({stageId,revision})), historyRevisions };
        } else if (entityId) {
          selector = { schemaVersion: 1, projectId, purpose: 'stage', stageId, entityId, stageRevisions: stages[stageId] ? [{ stageId, revision: stages[stageId].revision }] : [] };
          if (stageId === 2) {
            const raw = stages[2]?.content?.draft?.fields?.[`interviewRecord:${entityId}`];
            let interview; try { interview = JSON.parse(raw); } catch { throw new ProbeFailure('TEACHING_INTERVIEW_SOURCE_UNVERIFIED'); }
            if (interview.id === entityId && typeof interview.problemEntityId === 'string' && Number.isInteger(interview.topicRevision) && interview.topicRevision > 0) {
              selector.sourceEntityId = interview.problemEntityId; selector.stageRevisions.unshift({ stageId: 1, revision: interview.topicRevision });
            }
          }
        } else {
          const selected = new Map(Object.values(stages).map(stage => [stage.stageId, stage.revision]));
          for (const ref of stages[stageId]?.sourceStageRevisions ?? []) selected.set(ref.stageId, ref.revision);
          selector = { schemaVersion: 1, projectId, purpose: 'stage', stageId, stageRevisions: [...selected].sort(([a],[b]) => a-b).map(([stageId, revision]) => ({ stageId, revision })) };
          if (url.searchParams.get('returnRevision')) selector.returnRevision = Number(url.searchParams.get('returnRevision'));
        }
        await api(page, 'GET', `/api/chat/threads/${encodeURIComponent(threadId)}`);
        await api(page, 'GET', `/api/threads/${encodeURIComponent(threadId)}/skill-deviations?projectId=${encodeURIComponent(projectId)}`);
        const pin = guard.teachingPin(stageId, threadId, entityId ?? undefined); if (!pin) throw new ProbeFailure('TEACHING_SKILL_PIN_UNVERIFIED');
        const scope = { origin: ORIGIN, projectId, stageId, threadId, actorId: guard.identity().actor, prompt, selector, testPlan, interviewFinding, interviewGuideRevision, problemRevision, syntheticProblemFixture, ...pin, timeoutMs: 180000 };
        if (profile !== V2_VOICE_PROFILE && !summary && !syntheticProblemFixture && !guard.stageTextReceipt(stageId)) {
          const file = guard.armStageText(scope);
          const uploadPath = `/api/chat/threads/${encodeURIComponent(threadId)}/attachments`;
          const input = page.getByTestId('chat-attachment-file-input');
          await expect(input).toBeEnabled();
          const [upload] = await Promise.all([
            page.waitForResponse(response => response.request().method() === 'POST' && response.url() === ORIGIN + uploadPath),
            input.setInputFiles({ name: file.filename, mimeType: file.mime, buffer: file.bytes }),
          ]);
          const receipt = guard.stageTextReceipt(stageId);
          if (!upload.ok() || !receipt) throw new ProbeFailure('STAGE_TEXT_UPLOAD_RECEIPT_REJECTED');
          const pending = page.getByTestId('chat-attachment-list').locator('[data-status="uploaded"]')
            .getByText(receipt.filename, { exact: true });
          await expect(pending).toBeVisible();
          scope.stageFile = receipt;
        }
        const proof = await sendTeachingFeedback({ page, expect, scope, read: path => api(page, 'GET', path), armSend: current => guard.armTeachingSend(current),
          onEvent: event => recordTeachingEvent(event, scope, report.pendingTeachingReviews,
            text => sensitiveEvidence.assertSafe(text), value => console.log(JSON.stringify({ ...value, owner: 'root/aidt_ui_first_acceptance' }))),
          onPendingReview: async receipt => {
            const entry = { stageId, capture: { status: 'not-captured', code: 'TOOL_REVIEW_SCOPE_UNVERIFIED', dialogObserved: false, captured: false, domRequestIdentityVerified: false } };
            if (report.pendingTeachingReviews.length >= 6) return;
            report.pendingTeachingReviews.push(entry);
            try {
              const safeReceipt = pendingTeachingReviewReceipt(receipt, scope, page.url(), guard.teachingPin(stageId, threadId, entityId ?? undefined));
              sensitiveEvidence.assertSafe(JSON.stringify(safeReceipt));
              entry.receipt = safeReceipt;
              if (!syntheticProblemFixture && stageId === 1 && safeReceipt.knownConfirmTaskIntent) {
                guard.recordPendingProblem(safeReceipt);
                isolatedKnownS1Review = true;
              }
              pendingReviewCapture = { receipt: safeReceipt, scope };
              entry.capture = await observePendingTeachingReview({ page, capture: () => capture(`${String(stageId).padStart(2,'0')}-owned-tool-review${suffix}`, stageId, 'owned-tool-review', safeReceipt) });
            } catch { /* A diagnostic failure must not replace the real tool-review checkpoint. */ }
            finally { pendingReviewCapture = null; }
          } });
        sensitiveEvidence.assertSafe(proof.assistantText);
        guard.completeTeaching(proof);
        if (scope.stageFile) {
          const readback = guard.stageTextReceipt(stageId);
          if (readback?.messageId !== proof.inputMessageId) throw new ProbeFailure('STAGE_TEXT_BINDING_CHANGED');
          const route = page.url();
          await page.reload();
          await expect(page).toHaveURL(route);
          const attachment = page.getByTestId(`chat-message-attachment-${readback.id}`);
          await expect(attachment).toBeVisible();
          await expect(attachment).toContainText(readback.filename);
          const read = await api(page, 'GET', `/api/chat/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(readback.id)}/content`);
          const verified = guard.stageTextReceipt(stageId);
          if (read.status !== 200 || !verified?.contentVerified) throw new ProbeFailure('STAGE_TEXT_CONTENT_UNVERIFIED');
          report.stageFileEvidence ??= [];
          report.stageFileEvidence.push({ stageId, ...verified, uiReloadVerified: true });
          await attachment.scrollIntoViewIfNeeded();
          await capture(`${String(stageId).padStart(2, '0')}-stage-text-readback`, stageId);
        }
        report.teachingEvidence.push({ ...proof, projectId, entityId, checkpoint: name, interviewCode, syntheticProblemFixture, status: 'passed', prompt, source: identity.source, tag: identity.tag });
        await capture(profile === V2_VOICE_PROFILE ? (summary ? 'v2-final-report-real-chat' : `v2-teaching-s${stageId}-turn-${voiceTurn}`) : summary ? '07-native-report-chat' : `${String(stageId).padStart(2,'0')}-native-teaching-chat${suffix}${definitionTurn ? '-' + (definitionTurn + 1) : ''}${testTurn}${brainstormTurn}`, stageId);
      });
      if (!accepted) {
        if (!isolatedKnownS1Review) guard.stopTeaching();
        report.teachingEvidence.push({ stageId, checkpoint: name, interviewCode, syntheticProblemFixture, status: 'blocked-or-failed', evidence: 'See exact teaching checkpoint; no automatic retry or tool approval', teachingQualityAccepted: false, providerIndependentlyVerified: false });
      }
      return accepted;
    };
    const savePrint = async ({ stage, name, button, requiredTexts, imageHashes }) => {
      if (profile === V2_VOICE_PROFILE) throw new ProbeFailure('V2_LEGACY_PRINT_PROFILE_CONFLICT');
      const key = assertAidtPrintRequest(stage, name, report.systemArtifacts);
      assertCaptureScope(page.url(), projectId, stage); recheckRuntime();
      const assertSafe = async text => {
        sensitiveEvidence.assertSafe(text);
        const tokenPresent = await page.evaluate(text => { const token = localStorage.getItem('wsx.sessionToken'); return Boolean(token && text.includes(token)); }, text);
        if (tokenPresent || /Bearer\s+[A-Za-z0-9._~-]{12,}|\bsk-[A-Za-z0-9]{16,}/.test(text)) throw new ProbeFailure('PRINT_ARTIFACT_SENSITIVE');
      };
      const result = await captureApplicationPrint({ page, context, button, projectId, requiredTexts, imageHashes, assertSafe });
      const base = `qa-system-${identity.run}-${identity.attempt}-${key}`;
      const filename = `${base}.pdf`, htmlFilename = `${base}.html`;
      writeFileSync(resolve(output.out, filename), result.bytes, { flag: 'wx', mode: 0o600 });
      writeFileSync(resolve(output.out, htmlFilename), result.html, { flag: 'wx', mode: 0o600 });
      const receipt = { stage, printName: key, filename, htmlFilename, format: 'pdf', ...result.metadata, projectId, source: identity.source, tag: identity.tag };
      report.systemArtifacts.push(receipt); return receipt;
    };
    const nativeActionObserver = profile === V2_VOICE_PROFILE ? createV2NativeActionObserver({ page, expect, read: path => api(page, 'GET', path),
      guard, plan, report, runtimeScope, assertSafe: text => sensitiveEvidence.assertSafe(text), capture, candidateActions: metadata.candidateActions }) : undefined;
    const readResearchDocument = async pin => {
      if (profile !== V2_VOICE_PROFILE) throw new ProbeFailure('V2_RESEARCH_PROFILE_REQUIRED');
      const ids = guard.summary().ownedResearchIds;
      if (!Array.isArray(ids) || ids.length !== 1 || !/^[A-Za-z0-9._:-]{1,256}$/.test(ids[0]) || pin?.researchId && pin.researchId !== ids[0]) throw new ProbeFailure('V2_RESEARCH_OWNED_ID_REQUIRED');
      const response = await api(page, 'GET', `/api/interviews/digital/${encodeURIComponent(ids[0])}/markdown`);
      if (response.status !== 200 || response.data?.interviewId !== ids[0] || !Array.isArray(response.data.documents)) throw new ProbeFailure('V2_RESEARCH_CURRENT_READ_FAILED');
      // The current read is fresh evidence only. A supplied historical document pin may never be silently upgraded.
      if (pin && !response.data.documents.some(document => document.documentId === pin.documentId && document.version === pin.version && document.contentHash === pin.contentHash)) throw new ProbeFailure('V2_RESEARCH_FROZEN_DOCUMENT_UNAVAILABLE');
      return response.data;
    };
    const runV2UIAction = async input => {
      if(profile!==V2_VOICE_PROFILE||!actionWindow||typeof input?.perform!=='function')throw new ProbeFailure('V2_UI_ACTION_PROFILE_REQUIRED');
      recheckRuntime();actionWindow.begin(input);
      try {await input.perform();await expect.poll(()=>{const value=actionWindow.active();return !!value&&value.index===value.total&&!value.pending;},{timeout:input.timeoutMs??30000,intervals:[50,100,250]}).toBe(true);return actionWindow.finish(input.actionId);}
      catch(error){actionWindow.abort('V2_UI_ACTION_UNKNOWN_OUTCOME');throw error;}
    };
    const armToolDecision = async input => {
      if(profile!==V2_VOICE_PROFILE||!input||typeof input.perform!=='function'||!input.review)throw new ProbeFailure('V2_ASR_ACTUAL_ROOT_REVIEW_REQUIRED');
      const op=plan.operations.find(row=>row.id===input.operationId),url=new URL(page.url()),review=input.review;
      if(!op||op.kind!=='write'||![2,6].includes(op.stage)||url.pathname!==`/aidt/${projectId}`||url.searchParams.get('step')!==String(op.stage)||url.searchParams.get('entity')!==review.entityId||review.projectId!==projectId||review.runId!==input.runId||review.permissionRequestId!==input.permissionRequestId||review.toolName!==input.toolName||review.argsSha256!==input.argsSha256)throw new ProbeFailure('V2_ASR_ROOT_REVIEW_SCOPE_CHANGED');
      const fresh=await api(page,'GET',`/api/agent-runs/${encodeURIComponent(input.runId)}`);if(fresh.status!==200)throw new ProbeFailure('V2_ASR_FRESH_PENDING_READ_REQUIRED');
      recheckRuntime();guard.armV2Operation({operationId:op.id,kind:'write',requestKind:'asr-permission-once',stageId:op.stage,entityRole:op.entityRole,entityId:review.entityId,expectedFields:{decision:'once',asrPermission:{runId:input.runId,permissionRequestId:input.permissionRequestId,toolName:input.toolName,argsSha256:input.argsSha256,review}}});
      const path=`/api/agent-runs/${encodeURIComponent(input.runId)}/permission-requests/${encodeURIComponent(input.permissionRequestId)}/decision`;
      let response;try{[response]=await Promise.all([page.waitForResponse(value=>value.request().method()==='POST'&&new URL(value.url()).origin===ORIGIN&&new URL(value.url()).pathname===path,{timeout:30000}),input.perform()]);}catch{guard.fail('V2_ASR_PERMISSION_OUTCOME_UNKNOWN');throw new ProbeFailure('V2_ASR_PERMISSION_OUTCOME_UNKNOWN');}
      if(response.status()!==200){guard.fail('V2_ASR_PERMISSION_NOT_CONFIRMED_NO_REPLAY');throw new ProbeFailure('V2_ASR_PERMISSION_NOT_CONFIRMED_NO_REPLAY');}
      const actual=ledger.summary().operations.find(row=>row.id===op.id);if(actual?.status!=='SUCCEEDED'||guard.fatal())throw new ProbeFailure(guard.fatal()??'V2_ASR_PERMISSION_RECEIPT_REQUIRED');
      return {operationId:op.id,decision:'once',status:200,runId:input.runId,permissionRequestId:input.permissionRequestId,viaNormalUI:true,actualRootReview:true};
    };
    const prepareSourceImages = async coordinates => {
      if(profile!==V2_VOICE_PROFILE||!coordinates||!Array.isArray(coordinates.ideaIds)||![1,3].includes(coordinates.ideaIds.length))throw new ProbeFailure('V2_DESIGN_SOURCE_COORDINATES_REQUIRED');
      const stage4=await api(page,'GET',`/api/projects/${projectId}/aidt/stages/4/revision/${coordinates.stage4Revision}`),current=await api(page,'GET',`/api/projects/${projectId}/aidt/stages/5`);
      if(stage4.status!==200||stage4.data?.stage?.revision!==coordinates.stage4Revision||current.status!==200)throw new ProbeFailure('V2_DESIGN_SOURCE_EXACT_READ_REQUIRED');
      const fields=current.data?.stage?.content?.draft?.fields??{};let confirmation,round;
      try{confirmation=JSON.parse(fields[`prototypeText:${coordinates.designId}:prototypeTextConfirmation`]??'null');round=JSON.parse(stage4.data.stage.content.draft.fields['ideaBrainstormRoundCompletion:'+coordinates.brainstormId]??'null');}catch{throw new ProbeFailure('V2_DESIGN_SOURCE_SAVED_FIELDS_REQUIRED');}
      if(!Number.isSafeInteger(confirmation?.stageRevision)||!Array.isArray(round?.sheets))throw new ProbeFailure('V2_DESIGN_SOURCE_CONFIRMED_REVISION_REQUIRED');
      const confirmed=await api(page,'GET',`/api/projects/${projectId}/aidt/stages/5/revision/${confirmation.stageRevision}`);if(confirmed.status!==200||confirmed.data?.stage?.revision!==confirmation.stageRevision)throw new ProbeFailure('V2_DESIGN_TEXT_FROZEN_READ_REQUIRED');
      const hashes=new Set();for(const ideaId of coordinates.ideaIds){const sheet=round.sheets.find(row=>row.id===ideaId);let ref;try{ref=JSON.parse(sheet?.imageMaterial??'null');}catch{}if(!ref||ref.projectId!==projectId||!ref.runId||!ref.sha256||hashes.has(ref.sha256))throw new ProbeFailure('V2_DESIGN_DISTINCT_SOURCE_IMAGE_REQUIRED');hashes.add(ref.sha256);const actual=await api(page,'GET',`/api/ingestion-runs/${encodeURIComponent(ref.runId)}/content?projectId=${encodeURIComponent(projectId)}`);if(actual.status!==200)throw new ProbeFailure('V2_DESIGN_SOURCE_BYTES_READ_REQUIRED');}
      const result=guard.registerDesignSourceImages(coordinates);if(result.images.length!==coordinates.ideaIds.length)throw new ProbeFailure('V2_DESIGN_SOURCE_IMAGE_COUNT_REQUIRED');return result.images;
    };
    const runNativeOperation = async input => {
      if (profile !== V2_VOICE_PROFILE || !ledger) throw new ProbeFailure('V2_NATIVE_OPERATION_PROFILE_REQUIRED');
      const arm = v2NativeOperationInput(input, plan);
      if(arm.requestKind==='asr-file'){const observed=await prepareV2NativeExpected({read:path=>api(page,'GET',path),guard,projectId,stageId:arm.stageId,rawUrl:page.url()});arm.expectedFields={...(arm.expectedFields??{}),nativeActionPrefix:metadata.candidateActions.test,selector:observed.selector,threadId:observed.threadId,skillId:observed.skillId,skillVersionId:observed.skillVersionId,knownMessages:observed.knownMessages};}
      recheckRuntime(); guard.armV2Operation(arm);if(arm.requestKind==='design-generate')guard.armDesignGeneration({designId:arm.resourceId});
      try { await input.perform(); }
      catch { guard.fail('V2_NATIVE_UI_OPERATION_OUTCOME_UNKNOWN'); throw new ProbeFailure('V2_NATIVE_UI_OPERATION_OUTCOME_UNKNOWN'); }
      const maximumMs = arm.kind === 'design' ? 900000 : ['research','asr'].includes(arm.kind) ? 300000 : 30000;
      let final;
      await expect.poll(() => {
        final = ledger.summary().operations.find(item => item.id === arm.operationId);
        if (guard.fatal() || ['FAILED','UNKNOWN'].includes(final?.status)) return true;
        return final?.status === 'SUCCEEDED'||arm.requestKind==='asr-file'&&final?.status==='SENT'&&!!guard.nativeTeachingState(arm.operationId)?.wire;
      }, { timeout: maximumMs, intervals: [250,500,1000] }).toBe(true);
      if (guard.fatal() || final?.status !== 'SUCCEEDED'&&!(arm.requestKind==='asr-file'&&final?.status==='SENT')) throw new ProbeFailure(guard.fatal() ?? 'V2_NATIVE_UI_OPERATION_NOT_CONFIRMED');
      return { operationId: arm.operationId, kind: arm.kind, status: final.status, receipt: final.receipt };
    };
    const completeAsrOperation = async ({operationId,runId}) => {
      const op=plan.operations.find(row=>row.id===operationId),state=guard.nativeTeachingState(operationId);
      if(profile!==V2_VOICE_PROFILE||op?.kind!=='asr'||!state?.scope||!state.wire)throw new ProbeFailure('V2_ASR_ACCEPTED_OPERATION_REQUIRED');
      const messages=await api(page,'GET',`/api/chat/threads/${encodeURIComponent(state.scope.threadId)}/messages?limit=100`),current=guard.nativeTeachingState(operationId);
      if(messages.status!==200||current?.accepted?.runId!==runId)throw new ProbeFailure('V2_ASR_CANONICAL_RUN_REQUIRED');
      const run=await api(page,'GET',`/api/agent-runs/${encodeURIComponent(runId)}`),receipt=await api(page,'GET',`/api/agent-runs/${encodeURIComponent(runId)}/aidt-context`);
      if(run.status!==200||receipt.status!==200||run.data.status!=='succeeded')throw new ProbeFailure('V2_ASR_SUCCEEDED_RUN_AND_CONTEXT_REQUIRED');
      const calls=(run.data.steps??[]).filter(step=>step.kind==='tool_call'&&step.status==='succeeded'&&step.toolName==='wx_audio_transcribe');
      const published=(run.data.steps??[]).filter(step=>step.kind==='tool_call'&&step.status==='succeeded'&&step.toolName==='wx_artifact_publish');
      const summary=calls[0]?.toolResultSummary,prefix='audio-transcription-receipt:v1 ';let toolProof,publishArgs;
      try{toolProof=JSON.parse(summary?.slice(prefix.length));publishArgs=JSON.parse(published[0]?.toolArgsSummary);}catch{throw new ProbeFailure('V2_ASR_REAL_TOOL_PROOF_REQUIRED');}
      const sourceHash=/SHA256=([a-f0-9]{64})/.exec(state.scope.prompt)?.[1];
      if(calls.length!==1||published.length!==1||typeof summary!=='string'||!summary.startsWith(prefix)||createHash('sha256').update(summary).digest('hex')!==calls[0].outputDigest||toolProof?.status!=='succeeded'||toolProof.sourceHash!==sourceHash||publishArgs.workspacePath!==toolProof.workspacePath||publishArgs.mediaType!=='application/json')throw new ProbeFailure('V2_ASR_REAL_TOOL_PROOF_REQUIRED');
      const proof=validateTeachingEvidence({messages:messages.data,run:run.data,receipt:receipt.data},state.scope,state.wire,current.accepted,current.snapshotHash);guard.completeTeaching(proof);
      report.teachingEvidence.push({...proof,entityId:state.scope.selector.entityId,projectId,checkpoint:operationId,prompt:state.scope.prompt,status:'passed',source:identity.source,controlSource:identity.controlSource,tag:identity.tag,evidenceKind:'synthetic-file-asr',providerIndependentlyVerified:false});
      return {operationId,runId,status:'SUCCEEDED',actualAsrAndPublishReceipts:true,publishedFileBytesVerifiedSeparately:true};
    };
    const printFormal = async ({ stage: printStage, name, entityId, button, requiredTexts = [], imageHashes = [], expectedImageCount, sourceRevision }) => {
      if (profile !== V2_VOICE_PROFILE || !ledger) throw new ProbeFailure('V2_PRINT_PROFILE_REQUIRED');
      const outputPlan = plan.formalOutputs.find(item => item.name === name && item.stage === printStage);
      const jobs = plan.printJobs.filter(item => item.outputName === name && item.stage === printStage);
      if (!outputPlan || jobs.length !== 3 || !Number.isSafeInteger(sourceRevision) || sourceRevision < 1) throw new ProbeFailure('V2_PRINT_FORMAL_OUTPUT_NOT_PLANNED');
      const current = new URL(page.url());
      if (current.searchParams.get('entity') !== entityId) throw new ProbeFailure('V2_PRINT_FORMAL_ENTITY_CHANGED');
      const items = [];
      for (const job of jobs) {
        ledger.claimPrint(job.name, runtimeScope());
        if (!nativeDriver || !report.nativePrintCapability?.available || report.nativePrintBudget.exhausted) {
          const code = report.nativePrintBudget.exhausted ? 'V2_PRINT_RUN_BYTE_BOUND' : report.nativePrintCapability?.blockCode ?? 'NATIVE_SYSTEM_PRINT_CAPABILITY_BLOCKED';
          ledger.settlePrint(job.name, { scope: runtimeScope(), outcome: 'blocked', code });
          items.push({ printName: job.name, stage: printStage, sourceRevision, status: 'BLOCKED', code });
          continue;
        }
        recheckRuntime(); assertCaptureScope(page.url(), projectId, printStage);
        try {
          const artifactName = `qa-system-${identity.run}-${identity.attempt}-${name}`;
          const result = await nativeDriver.capture({ page, previewButton: button, paper: job.paper, projectId, stage: printStage, artifactName, requiredTexts, imageHashes, expectedImageCount });
          const copied = await storeV2PrintFiles({ result, ownedRuntime: nativeRuntime, outputDirectory: output.out,
            assertSafe: text => sensitiveEvidence.assertSafe(text), verifyImage: bytes => verifyPng(browser, bytes, 24),
            budget: { pdfRemainingBytes: report.nativePrintBudget.pdfMaximumBytes - report.nativePrintBudget.pdfBytes, renderRemainingBytes: report.nativePrintBudget.renderMaximumBytes - report.nativePrintBudget.renderBytes } });
          report.nativePrintBudget.pdfBytes += copied.pdfBytes; report.nativePrintBudget.renderBytes += copied.renderBytes;
          const stageBytes = report.nativePrintBudget.byStage[printStage] ??= { pdfBytes: 0, renderBytes: 0, files: [] };
          stageBytes.pdfBytes += copied.pdfBytes; stageBytes.renderBytes += copied.renderBytes; stageBytes.files.push({ printName: job.name, pdfBytes: copied.pdfBytes, renderBytes: copied.renderBytes });
          const receipt = { stage: printStage, printName: job.name, format: 'pdf', projectId, entityId, sourceRevision, source: identity.source,
            controlSource: identity.controlSource, tag: identity.tag, paper: job.paper, status: 'PENDING_INDEPENDENT_REVIEW', ...copied, ...result.metadata };
          report.systemArtifacts.push(receipt); items.push(receipt);
          // Real files and all-page mechanical checks are retained. Root's independent glyph/content
          // review is still required; no automatic mapping to contentVerified=true is permissible.
          ledger.settlePrint(job.name, { scope: runtimeScope(), outcome: 'blocked', code: 'PDF_VISUAL_REVIEW_REQUIRED' });
        } catch (error) {
          const code = safeCode(error); if (code === 'V2_PRINT_RUN_BYTE_BOUND') report.nativePrintBudget.exhausted = true; ledger.settlePrint(job.name, { scope: runtimeScope(), outcome: 'blocked', code });
          items.push({ printName: job.name, stage: printStage, sourceRevision, status: 'BLOCKED', code, unknownFileOutcomePreserved: true });
          // Print failure never resends a model request or blocks independently testable features.
        }
      }
      report.formalPrintChecks ??= []; report.formalPrintChecks.push(...items);
      return { status: items.every(item => item.status === 'PENDING_INDEPENDENT_REVIEW') ? 'PENDING_INDEPENDENT_REVIEW' : 'BLOCKED', artifacts: items };
    };

    stage = 'six-stage-journey';
    const { runAidtJourney, REQUIRED_CHECKS } = await import('./devapp-aidt-journey.mjs');
    if (!Array.isArray(REQUIRED_CHECKS) || REQUIRED_CHECKS.length < 6) throw new ProbeFailure('JOURNEY_REQUIREMENTS_INVALID');
    await checkpoint('unknown-project-denied', async () => {
      const result = await api(page, 'GET', `/api/projects/${identity.deniedProject}/overview`);
      if (![403, 404].includes(result.status)) throw new ProbeFailure('UNKNOWN_PROJECT_NOT_DENIED');
      report.unknownProjectGate = { passed: true, status: result.status, crossUserIsolation: false };
    });
    const reviewS1StudentResponse = agentReviewer?.bindPage({ page, context,
      readStage: async question => {
        if (question.projectId !== projectId) throw new ProbeFailure('AGENT_QA_PAGE_CHANGED');
        const result = await api(page, 'GET', `/api/projects/${projectId}/aidt/stages/1`);
        if (result.status !== 200) throw new ProbeFailure('AGENT_QA_SAVED_VERSION_CHANGED');
        return result.data?.stage;
      },
      readMessages: async question => {
        if (question.projectId !== projectId) throw new ProbeFailure('AGENT_QA_PAGE_CHANGED');
        const result = await api(page, 'GET', `/api/chat/threads/${encodeURIComponent(question.threadId)}/messages?limit=100`);
        if (result.status !== 200) throw new ProbeFailure('AGENT_QA_MESSAGES_CHANGED');
        return result.data;
      } });
    const asrPorts=profile===V2_VOICE_PROFILE&&asrReviewer?asrReviewer.bindPage({page,context,armToolDecision,
      readRun:async q=>{const value=await api(page,'GET',`/api/agent-runs/${encodeURIComponent(q.runId)}`);if(value.status!==200)throw new ProbeFailure('V2_ASR_REVIEW_RUN_UNAVAILABLE');return value.data;},
      readStage:async q=>{if(q.projectId!==projectId||![2,6].includes(q.stageId))throw new ProbeFailure('V2_ASR_REVIEW_STAGE_SCOPE_CHANGED');const value=await api(page,'GET',`/api/projects/${projectId}/aidt/stages/${q.stageId}`);if(value.status!==200)throw new ProbeFailure('V2_ASR_REVIEW_STAGE_UNAVAILABLE');return value.data?.stage;}}):{};
    const selectedJourney = profile === V2_VOICE_PROFILE ? (await import('./devapp-aidt-v2-journey.mjs')).runV2VoiceJourney : runAidtJourney;
    await selectedJourney({ page, context, expect, interviewStarter: metadata.interviewStarter, scope: { projectId, projectName: identity.projectName, runId: identity.run, runAttempt: identity.attempt, source: identity.source, tag: identity.tag, syntheticLabel: '合成验收数据，非真实访谈' },
      checkpoint, capture, api: path => api(page, 'GET', path), saveStage, reviewAndSave, saveReport, saveDownload, savePrint, teachingFeedback,
      ...(profile === V2_VOICE_PROFILE ? { plan, ledger, runtimeScope, nativeActionObserver, observeNativeAction: nativeActionObserver, runNativeOperation, prepareSourceImages, runV2UIAction, armToolDecision, completeAsrOperation, ...asrPorts, printFormal, readResearchDocument, audioFixture:readV2SyntheticAudioFixture(metadata,identity), surveyPublication:()=>guard.surveyPublication(), armStageSave: (stageId, confirmation) => guard.armStageSave(stageId, confirmation) } : {}),
      armInterviewEdit: () => guard.armStageSave(2, false), armCardCreate: stage => guard.armStageSave(stage, false),
      registerFixture: fixture => guard.registerFixture(fixture), armSurvey: id => guard.armSurvey(id), surveyReceipt: guard.surveyReceipt, armDesignCreate: () => guard.armDesignCreate(), armDesignGeneration: () => guard.armDesignGeneration(), armDesignImage: fixture => guard.armDesignImage(fixture), createAnonymousPage, createSurveyParticipant, reviewS1StudentResponse, report });
    const after = runtimeProof(identity);
    if (JSON.stringify(after) !== JSON.stringify(report.deployedRuntime)) throw new ProbeFailure('RUNTIME_CHANGED_DURING_ACCEPTANCE');
    if (profile === V2_VOICE_PROFILE) {
      report.asrReview=asrReviewer?.summary(); report.v2Acceptance = ledger.summary(); report.requiredChecks = plan.caseIds;
      report.passed = !guard.fatal() && report.v2Acceptance.fullAcceptancePassed;
      report.fullAcceptancePassed = report.passed; report.uiChecksPassed = !guard.fatal() && report.v2Acceptance.cases.every(item => item.status === 'PASSED' || item.caseId.startsWith('PRINT-') && item.status === 'BLOCKED');
      report.teachingNativeChainVerified = [1,2,3,4,5,6].every(stageId => report.teachingEvidence.some(item => item.stageId === stageId && item.status === 'passed'));
      if (!report.passed) report.failure = guard.fatal() ?? 'V2_REQUIRED_CASES_OR_VISUAL_REVIEW_INCOMPLETE';
      return;
    }
    report.requiredChecks = ['homepage-ui-create-persist', 'unknown-project-denied', ...REQUIRED_CHECKS, 'teaching-chat-final-report', 'teaching-chat-stage-3-2', 'teaching-chat-stage-3-3', 'teaching-chat-stage-3-4', 'teaching-chat-stage-4-reverse', 'teaching-chat-stage-6-plan', 'teaching-chat-stage-6-survey-plan', 'teaching-chat-stage-6-survey', ...[1,2,3,4,5,6].map(stageId => `teaching-chat-stage-${stageId}`)];
    report.stageFileCoverageVerified = [1, 2, 3, 4, 5, 6].every(stageId => report.stageFileEvidence?.some(row => row.stageId === stageId && row.uiReloadVerified && row.contentVerified));
    report.passed = !guard.fatal() && report.stageFileCoverageVerified
      && report.requiredChecks.every(name => report.checkpoints.some(item => item.name === name && item.status === 'passed'));
    // UI/runtime checks and exported PDF bytes are complete here; final glyph
    // acceptance is performed independently on the retained artifacts.
    report.fullAcceptancePassed = false;
    report.uiChecksPassed = report.passed;
    report.teachingNativeChainVerified = [1,2,3,4,5,6].every(stageId => report.teachingEvidence.some(item => item.stageId === stageId && !item.syntheticProblemFixture && item.status === 'passed'))
      && report.teachingEvidence.filter(item => !item.syntheticProblemFixture).every(item => item.status === 'passed');
    report.realModelVerified = false;
    if (!report.passed) report.failure = guard.fatal() ?? 'REQUIRED_CHECKS_NOT_ALL_PASSED';
  } catch (error) { report.failure = safeCode(error); report.failedStage = stage; }
  finally {
    clearTimeout(timer);
    if (ledger) {
      report.asrReview = asrReviewer?.summary();
      report.v2Acceptance = ledger.summary();
    }
    if (agentReviewer) report.agentReview = agentReviewer.summary();
    let privateEvidenceSafe = true;
    try {
      if (credentials) {
        const encoded = JSON.stringify(report); sensitiveEvidence.assertSafe(encoded);
        if ((report.stageEvidence?.length || report.teachingEvidence?.length) && (!page || page.isClosed())) throw new ProbeFailure('EVIDENCE_PRIVACY_REVIEW_UNAVAILABLE');
        if (page && !page.isClosed()) {
          const checked = await page.evaluate(text => { const token = localStorage.getItem('wsx.sessionToken'); return { available: Boolean(token), leaked: Boolean(token && text.includes(token)) }; }, encoded);
          if (checked.leaked || ((report.stageEvidence?.length || report.teachingEvidence?.length) && !checked.available)) throw new ProbeFailure('EVIDENCE_REPORT_SENSITIVE');
        }
      }
    } catch { privateEvidenceSafe = false; report.passed = false; report.fullAcceptancePassed = false; report.failure = 'EVIDENCE_PRIVACY_REVIEW_FAILED'; }
    try { await nativeDriver?.dispose(); } catch { /* Owned print session only. */ }
    try { await context?.close(); } catch { /* No raw errors. */ }
    try { await browser?.close(); } catch { /* No raw errors. */ }
    try { await nativeRuntime?.dispose(); } catch { /* This attempt's owned X display only. */ }
    if (guard) {
      report.requestScope = guard.summary();
      report.designGenerationWorkflowObserved = report.requestScope.designModel?.httpStatus === 200 && report.requestScope.designModel?.generatedFrames > 0;
      report.designProviderIndependentlyVerified = false;
      report.cleanup = { performed: false, reason: 'No delete API; consultant is not entitled to project lifecycle archive. Keep labelled synthetic QA project and evidence; no privilege escalation.' };
    }
    finalizeGuardVerdict(report, guard);
    const artifactReport = privateEvidenceSafe ? report : { kind: report.kind, target: ORIGIN, passed: false, fullAcceptancePassed: false, failure: 'EVIDENCE_PRIVACY_REVIEW_FAILED', source: identity?.source ?? null, tag: identity?.tag ?? null, note: 'Rich evidence was withheld rather than exposing unverified content.' };
    if (output && privateEvidenceSafe && report.checkpoints.length) writeFileSync(resolve(output.out, 'qa-report-illustrated-acceptance.md'), illustratedAcceptance(artifactReport), { flag: 'wx', mode: 0o600 });
    if (output) writeFileSync(resolve(output.out, 'acceptance.json'), `${JSON.stringify(artifactReport, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ kind: report.kind, passed: report.passed, failure: report.failure ?? null, ...publicEntryDiagnostic(report),
      source: identity?.source ?? null, tag: identity?.tag ?? null, checkpoints: report.checkpoints, screenshots: report.screenshots.map(({ filename, bytes, sha256 }) => ({ filename, bytes, sha256 })) }));
    process.exitCode = report.passed ? 0 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
