/** Pure control integration: fake ports and owned temporary files; no browser/network/account/model. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareV2Browser, parseV2NativeResponse, v2NativeOperationInput, candidateDialogLocator, storeV2PrintFiles } from '../../apps/web/e2e/support/devapp-aidt-acceptance.mjs';
import { V2_VOICE_PROFILE } from '../../apps/web/e2e/support/devapp-aidt-v2-profile.mjs';
import { BASELINE_BUNDLE_FILES, V2_CONTROL_BUNDLE_FILES, V2_DISPATCH_BUNDLE_FILES, candidateActionsFromSource } from '../build-aidt-acceptance-bundle.mjs';

const project = 'prj-11111111-1111-4111-8111-111111111111';
const sha = value => createHash('sha256').update(value).digest('hex');
function browserPorts({ available = false, actualAvailable = true } = {}) {
  const calls = [], context = { close: async () => calls.push('context-close') }, browser = { newContext: async options => { calls.push(['new-context', options]); return context; }, close: async () => calls.push('browser-close') };
  context.browser = () => browser;
  const driver = { preflight: async () => { calls.push('actual-system-dialog-probe'); return { available: actualAvailable, blockCode: actualAvailable ? null : 'PRINT_DIALOG_UNAVAILABLE' }; }, dispose: async () => calls.push('driver-dispose') };
  return { calls, browser, context, driver,
    chromium: { launch: async options => { calls.push(['launch', options]); return browser; }, launchPersistentContext: async (profile, options) => { calls.push(['launch-persistent', profile, options]); return context; } },
    io: { probe: () => { calls.push('host-capability-probe'); return { available, missing: available ? [] : ['xvfb'], blockCode: available ? null : 'NATIVE_SYSTEM_PRINT_CAPABILITY_BLOCKED' }; },
      prepare: async () => { calls.push('prepare-owned'); return { available: true, userDataDir: '/owned-only/profile', launchOptions: { headless: false, env: { DISPLAY: ':1100' } }, dispose: async () => calls.push('display-dispose') }; },
      createDriver: async () => { calls.push('create-driver'); return driver; } },
  };
}

test('missing host print tools yields a declared PRINT block but preserves ordinary headless functional browser', async () => {
  const ports = browserPorts(); const prepared = await prepareV2Browser({ chromium: ports.chromium, outputRoot: '/owned-output', assertSafe: () => {}, browserEnv: {}, io: ports.io });
  assert.equal(prepared.headless, true); assert.equal(prepared.driver, null); assert.equal(prepared.capability.available, false);
  assert.equal(ports.calls.some(row => Array.isArray(row) && row[0] === 'launch-persistent'), false);
  assert.equal(ports.calls.some(row => Array.isArray(row) && row[0] === 'launch' && row[1].headless === true), true);
});

test('real-capability path launches only its owned persistent headful profile and probes actual system dialog before login', async () => {
  const ports = browserPorts({ available: true }); const prepared = await prepareV2Browser({ chromium: ports.chromium, outputRoot: '/owned-output', assertSafe: () => {}, browserEnv: {}, io: ports.io });
  assert.equal(prepared.headless, false); assert.equal(prepared.driver, ports.driver); assert.equal(prepared.capability.available, true);
  assert.deepEqual(ports.calls.slice(0, 2), ['host-capability-probe', 'prepare-owned']);
  const launch = ports.calls.find(row => Array.isArray(row) && row[0] === 'launch-persistent'); assert.equal(launch[1], '/owned-only/profile'); assert.equal(launch[2].headless, false);
  assert.equal(ports.calls.at(-1), 'actual-system-dialog-probe'); assert.equal(ports.calls.some(row => Array.isArray(row) && row[0] === 'launch'), false);
});

test('an actual dialog failure closes only owned resources then falls back for feature QA, never fake page.pdf', async () => {
  const ports = browserPorts({ available: true, actualAvailable: false }); const prepared = await prepareV2Browser({ chromium: ports.chromium, outputRoot: '/owned-output', assertSafe: () => {}, browserEnv: {}, io: ports.io });
  assert.equal(prepared.driver, null); assert.equal(prepared.headless, true); assert.equal(prepared.capability.blockCode, 'PRINT_DIALOG_UNAVAILABLE');
  for (const event of ['driver-dispose','context-close','browser-close','display-dispose']) assert.equal(ports.calls.includes(event), true);
});

test('native report stream requires exactly one completed source at the terminal position', () => {
  const source = { interviewId: 'owned-research', version: 2, documents: [{ step: 'report', markdown: '明确模拟的实际保存报告' }] };
  const bytes = Buffer.from(JSON.stringify({ type: 'progress', value: 'composing' }) + '\n' + JSON.stringify({ type: 'completed', source }) + '\n');
  assert.deepEqual(parseV2NativeResponse(bytes, 'application/x-ndjson', { kind: 'v2-research-write' }), source);
  assert.deepEqual(parseV2NativeResponse(Buffer.from('{"actual":true}'), 'application/json', { kind: 'save-stage' }), { actual: true });
  for (const text of ['{"type":"progress"}\n', '{"type":"completed","source":{}}\n{"type":"progress"}\n', '{"type":"completed","source":{}}\n{"type":"completed","source":{}}\n']) assert.throws(() => parseV2NativeResponse(Buffer.from(text), 'application/x-ndjson', { kind: 'v2-research-write' }), /V2_NATIVE_STREAM_COMPLETION_REQUIRED/);
  assert.throws(() => parseV2NativeResponse(Buffer.from('{"type":"failed","reasonCode":"MODEL_FAILED"}\n'), 'application/x-ndjson', { kind: 'v2-research-write' }), /V2_NATIVE_STREAM_FAILED/);
  assert.throws(() => parseV2NativeResponse(bytes, 'application/x-ndjson', { kind: 'other' }), /V2_NATIVE_STREAM_SCOPE_REJECTED/);
});

test('native operation normalization is an exact reviewed vocabulary, not a URL-based wildcard', () => {
  const op = { id: 's5-prototype-three-html-generate', kind: 'design', stage: 5, entityRole: 'prototype-three' }, plan = { operations: [op] };
  assert.deepEqual(v2NativeOperationInput({ operationId: op.id, kind: op.kind, stage: 5, entityRole: op.entityRole, resourceId: 'actual-design', perform() {} }, plan), { operationId: op.id, kind: op.kind, stageId: 5, entityRole: op.entityRole, resourceId: 'actual-design', requestKind: 'design-generate' });
  for (const delta of [{ stageId: 6 }, { entityRole: 'other-prototype' }, { requestKind: 'survey-publish' }, { arbitraryUrl: '/api/permissions' }]) assert.throws(() => v2NativeOperationInput({ operationId: op.id, kind: op.kind, stage: 5, entityRole: op.entityRole, perform() {}, ...delta }, plan), /V2_NATIVE_OPERATION_/);
  const unknown = { id: 'unknown-new-generation', kind: 'design', stage: 5, entityRole: 'prototype-three' };
  assert.throws(() => v2NativeOperationInput({ operationId: unknown.id, kind: unknown.kind, stage: 5, entityRole: unknown.entityRole, perform() {} }, { operations: [unknown] }), /V2_NATIVE_OPERATION_KIND_NOT_CLOSED/);
});

test('candidate portal capture binds the current own S3 route and exact product dialog title', () => {
  const seen = [], page = { getByRole: (...args) => { seen.push(args); return { syntheticLocator: true }; } };
  candidateDialogLocator(page, V2_VOICE_PROFILE, `https://devapp.boardx.us/aidt/${project}?step=3&candidate=persona`, project, 3);
  assert.deepEqual(seen[0], ['dialog', { name: '从证据形成画像', exact: true }]);
  for (const [profile, url, stage] of [['baseline', `https://devapp.boardx.us/aidt/${project}?step=3&candidate=persona`, 3], [V2_VOICE_PROFILE, `https://app.workspacex.cn/aidt/${project}?step=3&candidate=persona`, 3], [V2_VOICE_PROFILE, `https://devapp.boardx.us/aidt/${project}?step=2&candidate=persona`, 2]]) assert.throws(() => candidateDialogLocator(page, profile, url, project, stage), /V2_CANDIDATE_DIALOG_SCOPE_REJECTED/);
});

function fileFixture(root) {
  const input = join(root, 'input'), output = join(root, 'output'); mkdirSync(input, { mode: 0o700 }); mkdirSync(output, { mode: 0o700 });
  const pdf = Buffer.from('%PDF-1.7\n' + ' '.repeat(600) + '\n%%EOF'), png = Buffer.alloc(600, 10);
  const names = ['owned-a4.pdf','owned-a4-system-dialog.png','owned-a4-save-dialog.png','owned-a4-page-1.png'];
  for (const name of names) writeFileSync(join(input, name), name.endsWith('.pdf') ? pdf : png, { mode: 0o600 });
  return { input, output, result: { bytes: pdf, metadata: { filename: names[0], sha256: sha(pdf), pages: [{ renderFilename: names[3] }] }, screens: names.slice(1, 3) }, ownedRuntime: { available: true, outputDirectory: input } };
}
test('native print collector copies only this owned explicit verified PDF/PNG set with identical hashes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aidt-v2-print-copy-'));
  try {
    const f = fileFixture(root); const result = await storeV2PrintFiles({ ...f, outputDirectory: f.output, assertSafe: () => {}, verifyImage: async () => ({ width: 100, height: 100 }) });
    assert.equal(result.files.length, 4); assert.equal(sha(readFileSync(join(f.output, 'owned-a4.pdf'))), f.result.metadata.sha256);
    assert.equal(existsSync(join(f.output, 'unlisted.txt')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('native print collector rejects unlisted traversal, changed PDF bytes and symlink sources', async () => {
  for (const mutation of ['traversal','changed-pdf','symlink']) {
    const root = mkdtempSync(join(tmpdir(), 'aidt-v2-print-deny-'));
    try {
      const f = fileFixture(root);
      if (mutation === 'traversal') f.result.screens[0] = '../other.png';
      if (mutation === 'changed-pdf') f.result.bytes = Buffer.from('%PDF-' + 'z'.repeat(600));
      if (mutation === 'symlink') { rmSync(join(f.input, f.result.screens[0])); symlinkSync(join(f.input, 'owned-a4-page-1.png'), join(f.input, f.result.screens[0])); }
      await assert.rejects(() => storeV2PrintFiles({ ...f, outputDirectory: f.output, assertSafe: () => {}, verifyImage: async () => ({}) }), /V2_PRINT_FILE_/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('candidate metadata is extracted from canonical source literals without evaluating or rewriting the prompt', () => {
  const actions = { problem:'[AIDT:FRAME:PROBLEM-CANDIDATES:1]', ideation:'[AIDT:IDEATE:IDEA-CANDIDATES:1]', prototype:'[AIDT:PROTOTYPE:TEXT-CANDIDATES:1]', test:'[AIDT:TEST:LEARNING-CANDIDATES:1]', interview:'[AIDT:INTERVIEW:DISCOVERY-CANDIDATES:1]', persona:'[AIDT:DEFINE:PERSONA-CANDIDATES:1]', hmw:'[AIDT:DEFINE:HMW-CANDIDATES:1]' };
  const source = 'export const AIDT_CANDIDATE_ACTIONS = {\n' + Object.entries(actions).map(([key, value]) => `  ${key}: "${value}",`).join('\n') + '\n} as const;';
  assert.deepEqual(candidateActionsFromSource(source), actions);
  assert.throws(() => candidateActionsFromSource(source.replace('  hmw:', '  unknown:')), /CANDIDATE_ACTION_VOCABULARY_INVALID/);
  assert.throws(() => candidateActionsFromSource(source.replace(/  hmw:.*\n/, '')), /CANDIDATE_ACTION_VOCABULARY_INVALID/);
  assert.throws(() => candidateActionsFromSource('export const AIDT_CANDIDATE_ACTIONS = obtainFromUnknownRuntime();'), /CANDIDATE_ACTION_VOCABULARY_INVALID/);
});

test('bundle/workflow keep a closed safe file set and explicit new profile while baseline keeps its old path', () => {
  assert.equal(BASELINE_BUNDLE_FILES.includes('apps/web/e2e/support/devapp-aidt-print-evidence.mjs'), true);
  for (const files of [BASELINE_BUNDLE_FILES, V2_CONTROL_BUNDLE_FILES, V2_DISPATCH_BUNDLE_FILES]) {
    assert.equal(new Set(files).size, files.length); assert.equal(files.some(file => /env|storage-state|trace|credential|\.png$|\.pdf$/.test(file)), false);
  }
  assert.equal(V2_CONTROL_BUNDLE_FILES.includes('apps/web/e2e/support/devapp-aidt-v2-journey.mjs'), true);
  const main = readFileSync(new URL('../../apps/web/e2e/support/devapp-aidt-acceptance.mjs', import.meta.url), 'utf8');
  const credentialRead = main.indexOf('credentials = reusableCredentials && !provisionOrdinaryQa ? reusableCredentials : readQaCredentials();');
  assert.ok(credentialRead > 0);
  assert.ok(main.indexOf('const prepared = await prepareV2Browser') >= 0 && main.indexOf('const prepared = await prepareV2Browser') < credentialRead);
  assert.match(main, /profile !== V2_VOICE_PROFILE[\s\S]*chromium\.launch\(\{ headless: true/);
  const workflow = readFileSync(new URL('../../.github/workflows/aidt-devapp-acceptance.yml', import.meta.url), 'utf8');
  assert.match(workflow, /acceptance_profile:[\s\S]*default: baseline/); assert.match(workflow, /v2-voice-20261122' && 360 \|\| 152/);
  assert.equal((workflow.match(/AIDT_ACCEPTANCE_PROFILE: \$\{\{ inputs\.acceptance_profile \}\}/g) ?? []).length, 2);
});


test('the run byte ceiling is checked over the complete explicit file set before copying any artifact', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aidt-v2-print-budget-'));
  try {
    const f = fileFixture(root);
    await assert.rejects(() => storeV2PrintFiles({ ...f, outputDirectory: f.output, assertSafe: () => {}, verifyImage: async () => ({}), budget: { pdfRemainingBytes: f.result.bytes.length - 1, renderRemainingBytes: 1073741824 } }), /V2_PRINT_RUN_BYTE_BOUND/);
    assert.equal(existsSync(join(f.output, 'owned-a4.pdf')), false);
    await assert.rejects(() => storeV2PrintFiles({ ...f, outputDirectory: f.output, assertSafe: () => {}, verifyImage: async () => ({}), budget: { pdfRemainingBytes: 536870913, renderRemainingBytes: 1073741824 } }), /V2_PRINT_RUN_BYTE_BUDGET_INVALID/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('synthetic speech fixture cannot select a secret path, silently exceed the old byte bound, or omit byte identity',async()=>{
  const {readV2SyntheticAudioFixture}=await import('../../apps/web/e2e/support/devapp-aidt-acceptance.mjs');
  const base={path:'apps/web/e2e/fixtures/aidt-v2/synthetic-prototype-test.wav',bytes:120000,sha256:'a'.repeat(64),mime:'audio/wav',synthetic:true,groundtruthSentToModel:false};
  for(const fixture of [{...base,path:'/private/config.env'},{...base,bytes:262145},{...base,groundtruthSentToModel:true},{...base,sha256:'unverified'}])assert.throws(()=>readV2SyntheticAudioFixture({syntheticAudioFixture:fixture},{run:'123'}));
});

test('actual acceptance finalizer preserves the first failure when no write ledger exists', () => {
  const source = readFileSync(new URL('../../apps/web/e2e/support/devapp-aidt-acceptance.mjs', import.meta.url), 'utf8');
  const body = source.split('finally {\n    clearTimeout(timer);')[1]?.split('    if (agentReviewer)')[0];
  assert.ok(body, 'the actual finalizer ledger projection must be present');
  const finalize = new Function('ledger', 'report', 'asrReviewer', body);
  const report = { failure: 'ENTRY_CREATION_OR_IDENTITY_FIRST_FAILURE' };
  assert.doesNotThrow(() => finalize(null, report, null));
  assert.deepEqual(report, { failure: 'ENTRY_CREATION_OR_IDENTITY_FIRST_FAILURE' });
});

test('actual acceptance finalizer projects only the present ledger summary once', () => {
  const source = readFileSync(new URL('../../apps/web/e2e/support/devapp-aidt-acceptance.mjs', import.meta.url), 'utf8');
  const body = source.split('finally {\n    clearTimeout(timer);')[1]?.split('    if (agentReviewer)')[0];
  assert.ok(body);
  const finalize = new Function('ledger', 'report', 'asrReviewer', body);
  let calls = 0; const report = {}, summary = { passed: false, scope: 'pure-control-fixture' };
  finalize({ summary: () => { calls++; return summary; } }, report, { summary: () => ({ reviewed: false }) });
  assert.equal(calls, 1); assert.equal(report.v2Acceptance, summary);
  assert.deepEqual(report.asrReview, { reviewed: false });
});
