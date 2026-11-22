/** Pure control tests only: no browsers, network, accounts, models or product writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BASELINE_PROFILE, V2_VOICE_PROFILE, V2_CASE_IDS, V2_REQUIRED_REAL_MODEL_CASE_IDS, V2_PAPERS,
  acceptanceProfile, buildV2ExecutionPlan, createV2ExecutionLedger, assertV2RuntimeIdentity,
} from '../../apps/web/e2e/support/devapp-aidt-v2-profile.mjs';
import { TEACHING_TURN_LIMIT } from '../../apps/web/e2e/support/devapp-aidt-acceptance-guard.mjs';
import { AIDT_PDF_PLAN } from '../../apps/web/e2e/support/devapp-aidt-acceptance.mjs';

const hash = 'a'.repeat(64), source = 'b'.repeat(40), controlSource = 'c'.repeat(40);
const identity = () => ({ source, controlSource, tag: '123-1', run: '456', attempt: '1', orgId: 'qa-org', actorId: 'qa-person', orgRole: 'consultant', projectId: 'prj-11111111-1111-4111-8111-111111111111' });
function fixture() {
  const operations = [];
  for (let stage = 1; stage <= 6; stage++) {
    const stageCases = V2_CASE_IDS.filter(id => id.startsWith(`AI-S${stage}-`) || stage === 6 && !id.startsWith('AI-'));
    operations.push({ id: `actual-ui-s${stage}`, kind: 'write', stage, entityRole: 'main', caseIds: stageCases.filter(id => !V2_REQUIRED_REAL_MODEL_CASE_IDS.includes(id)) });
    operations.push({ id: `actual-model-s${stage}`, kind: 'teaching', stage, entityRole: 'main', caseIds: stageCases.filter(id => V2_REQUIRED_REAL_MODEL_CASE_IDS.includes(id)) });
  }
  return {
    operations,
    formalOutputs: [{ name: 'final-saved-report', stage: 6, entityRole: 'report', caseIds: [...V2_CASE_IDS.filter(id => id.startsWith('PRINT-')), 'AI-S3-16'], defaultPaper: 'A4' }],
    caseBindings: V2_CASE_IDS.map(caseId => ({ caseId, operationIds: [`actual-${V2_REQUIRED_REAL_MODEL_CASE_IDS.includes(caseId) ? 'model' : 'ui'}-s${/^AI-S([1-6])-/.exec(caseId)?.[1] ?? 6}`], assertionIds: ['actual-action', 'specific-outcome'] })),
  };
}
const make = input => buildV2ExecutionPlan(input ?? fixture());
const receipt = () => ({ verified: true, sha256: hash, httpStatus: 200 });
function settle(ledger, id = 'actual-ui-s1', outcome = 'succeeded') {
  ledger.claimOperation(id, identity()); ledger.markOperationSent(id, identity()); ledger.settleOperation(id, { scope: identity(), outcome, receipt: receipt() });
}
function caseProof(id) {
  const readback = { projectId: identity().projectId, entityRole: 'main', revision: 1, contentSha256: hash };
  return { scope: identity(), actualUiActions: 2,
    assertionResults: ['actual-action', 'specific-outcome'].map(name => ({ id: name, passed: true, evidenceSha256: hash })),
    serverReadback: { ...readback }, refreshedReadback: { ...readback },
    screenshots: ['before', 'result', 'refreshed'].map(kind => ({ filename: `V2N-${id}-${kind}.png`, kind, sha256: hash, bytes: 1024 })) };
}
function printProof(paper = 'A4') {
  const sizes = { A4: [210, 297], A3: [297, 420], A1: [594, 841] };
  return { paper, systemDialogObserved: true, explicitApplicationPrint: true, realSystemSavedFile: true, headless: false, kiosk: false, usedPagePdf: false,
    independentlyInspectedAllPages: true, contentVerified: true, paginationVerified: true, pageCount: 2,
    pages: [1, 2].map(() => ({ widthMm: sizes[paper][0], heightMm: sizes[paper][1], renderSha256: hash, textSha256: hash, clipped: false, contentVerified: true })) };
}
function finishPrint(ledger, name, paper, patch = {}) {
  ledger.claimPrint(name, identity()); ledger.settlePrint(name, { scope: identity(), outcome: 'succeeded', proof: { ...printProof(paper), ...patch }, file: { filename: `V2N-${name}.pdf`, sha256: hash, bytes: 1024 } });
}

test('new profile is explicit and baseline retains its original 44 turns/16 PDFs', () => {
  assert.equal(acceptanceProfile({}), BASELINE_PROFILE);
  assert.equal(acceptanceProfile({ AIDT_ACCEPTANCE_PROFILE: 'baseline' }), BASELINE_PROFILE);
  assert.equal(acceptanceProfile({ AIDT_ACCEPTANCE_PROFILE: V2_VOICE_PROFILE }), V2_VOICE_PROFILE);
  for (const value of ['', 'latest', 'v2', 'BASELINE', null]) assert.throws(() => acceptanceProfile({ AIDT_ACCEPTANCE_PROFILE: value }), /ACCEPTANCE_PROFILE_INVALID/);
  assert.throws(() => acceptanceProfile({ AIDT_ACCEPTANCE_PROFILE: V2_VOICE_PROFILE, AIDT_ENTRY_DIAGNOSTIC_ONLY: 'true' }), /V2_PROFILE_DIAGNOSTIC_CONFLICT/);
  assert.equal(TEACHING_TURN_LIMIT, 44); assert.equal(AIDT_PDF_PLAN.length, 16);
});

test('case registry is exactly the unique approved 112 case IDs, not historical H/M green results', () => {
  assert.equal(V2_CASE_IDS.length, 112); assert.equal(new Set(V2_CASE_IDS).size, 112);
  assert.equal(V2_CASE_IDS.includes('AI-S4-12'), false); assert.equal(V2_CASE_IDS.includes('AI-S4-17'), true);
  assert.equal(V2_CASE_IDS.filter(id => id.startsWith('AI-')).length, 91);
  assert.equal(V2_CASE_IDS.filter(id => id.startsWith('CRUD-')).length, 10);
  assert.equal(V2_CASE_IDS.filter(id => id.startsWith('PRINT-')).length, 11);
  assert.equal(V2_CASE_IDS.some(id => /^H|^M/.test(id)), false);
});

test('closed named operations derive every limit and each output multiplies by all three papers', () => {
  const input = fixture(); input.formalOutputs.push({ name: 'persona-formal', stage: 3, entityRole: 'persona', caseIds: ['AI-S3-16'], defaultPaper: 'A1' });
  const plan = make(input);
  assert.deepEqual(V2_PAPERS, ['A4', 'A3', 'A1']);
  assert.equal(plan.limits.operations, 12); assert.equal(plan.limits.write, 6); assert.equal(plan.limits.teaching, 6);
  assert.equal(plan.limits.physicalMutationRequests, 12); assert.equal(plan.limits.logicalModelActions, 6); assert.equal(plan.limits.nativePdfFiles, 6);
  assert.deepEqual(plan.printJobs.filter(row => row.outputName === 'persona-formal').map(row => row.paper), ['A4', 'A3', 'A1']);
  assert.equal(plan.printJobs[3].defaultPaper, 'A1');
  assert.equal(Object.isFrozen(plan), true); assert.equal(Object.isFrozen(plan.operations[0].caseIds), true);
  assert.throws(() => { plan.limits.nativePdfFiles = 9999; }, TypeError);
  input.operations[0].caseIds.pop(); assert.equal(plan.operations[0].caseIds.length > input.operations[0].caseIds.length, true);
});

test('caller-supplied numeric caps, duplicate slots, unbound operations and missing cases are rejected', () => {
  const capped = fixture(); capped.limits = { teaching: 100000 }; assert.throws(() => make(capped), /V2_PLAN_SCHEMA_INVALID/);
  const duplicate = fixture(); duplicate.operations.push(structuredClone(duplicate.operations[0])); assert.throws(() => make(duplicate), /V2_OPERATION_DUPLICATE/);
  const unbound = fixture(); unbound.operations.push({ id: 'unbound-hidden-write', kind: 'write', stage: 3, entityRole: 'main', caseIds: ['AI-S1-01'] }); assert.throws(() => make(unbound), /V2_OPERATION_CASE_UNBOUND/);
  const missing = fixture(); missing.caseBindings.pop(); assert.throws(() => make(missing), /V2_PLAN_BOUND_OR_COVERAGE_INVALID/);
  const unknown = fixture(); unknown.caseBindings[0].caseId = 'H03'; assert.throws(() => make(unknown), /V2_CASE_BINDING_INVALID/);
});

test('model-required positive cases cannot be passed with only dispatch or ordinary writes', () => {
  const noModel = fixture(); noModel.operations[1].kind = 'write'; assert.throws(() => make(noModel), /V2_CASE_MODEL_(?:OPERATION_MISSING|STAGE_MISMATCH)/);
  const disabled = fixture(); disabled.caseBindings.find(row => row.caseId === 'AI-S1-04').requiresModel = false; assert.throws(() => make(disabled), /V2_CASE_MODEL_OPERATION_MISSING/);
  const ledger = createV2ExecutionLedger(make(), identity()); settle(ledger, 'actual-model-s1');
  ledger.beginCase('AI-S1-04', identity()); const evidence = caseProof('AI-S1-04'); assert.throws(() => ledger.markCasePassed('AI-S1-04', evidence), /V2_CASE_REAL_MODEL_REQUIRED/);
  evidence.realModelReceipt = { runId: 'run-1', threadId: 'thread-1', stageId: 1, sourceRevision: source, providerObserved: true, substitute: true, settled: true };
  assert.throws(() => ledger.markCasePassed('AI-S1-04', evidence), /V2_CASE_REAL_MODEL_REQUIRED/);
  evidence.realModelReceipt.substitute = false; evidence.realModelReceipt.sourceRevision = 'd'.repeat(40);
  assert.throws(() => ledger.markCasePassed('AI-S1-04', evidence), /V2_CASE_REAL_MODEL_REQUIRED/);
  evidence.realModelReceipt.sourceRevision = source; ledger.markCasePassed('AI-S1-04', evidence);
  assert.equal(ledger.summary().cases.find(row => row.caseId === 'AI-S1-04').status, 'PASSED');
});

test('identity binds app/controller/tag/ordinary actor/main project; a print capability is not a role override', () => {
  assert.deepEqual(assertV2RuntimeIdentity(identity(), identity()), identity());
  for (const patch of [{ source: 'd'.repeat(40) }, { controlSource: 'd'.repeat(40) }, { tag: '456-1' }, { projectId: 'prj-22222222-2222-4222-8222-222222222222' }, { actorId: 'other-person' }]) assert.throws(() => assertV2RuntimeIdentity(identity(), { ...identity(), ...patch }), /V2_RUNTIME_IDENTITY_CHANGED/);
  assert.throws(() => assertV2RuntimeIdentity(identity(), { ...identity(), orgRole: 'admin' }), /V2_RUNTIME_SCOPE_INVALID/);
  assert.throws(() => createV2ExecutionLedger(make(), { ...identity(), controlSource: 'develop' }), /V2_RUNTIME_SCOPE_INVALID/);
});

test('each operation is single-use and an unknown mutation stops all future mutations rather than replaying', () => {
  const ledger = createV2ExecutionLedger(make(), identity());
  assert.throws(() => ledger.markOperationSent('actual-ui-s1', identity()), /V2_OPERATION_NOT_CLAIMED/);
  assert.throws(() => ledger.claimOperation('not-reviewed', identity()), /V2_OPERATION_NOT_PLANNED/);
  ledger.claimOperation('actual-ui-s1', identity());
  assert.throws(() => ledger.claimOperation('actual-ui-s1', identity()), /V2_OPERATION_ALREADY_CONSUMED/);
  ledger.markOperationSent('actual-ui-s1', identity()); ledger.settleOperation('actual-ui-s1', { scope: identity(), outcome: 'unknown' });
  assert.equal(ledger.stopped(), 'V2_UNKNOWN_MUTATION_OUTCOME');
  assert.throws(() => ledger.claimOperation('actual-model-s1', identity()), /V2_UNKNOWN_MUTATION_OUTCOME/);
  assert.equal(ledger.summary().operations[0].status, 'UNKNOWN'); assert.equal(ledger.summary().fullAcceptancePassed, false);
});

test('known failure consumes its slot and cannot be automatically retried or counted successful', () => {
  const ledger = createV2ExecutionLedger(make(), identity()); settle(ledger, 'actual-ui-s1', 'failed'); ledger.beginCase('AI-S1-01', identity());
  assert.throws(() => ledger.claimOperation('actual-ui-s1', identity()), /V2_OPERATION_ALREADY_CONSUMED/);
  assert.throws(() => ledger.markCasePassed('AI-S1-01', caseProof('AI-S1-01')), /V2_CASE_OPERATIONS_INCOMPLETE/);
  assert.equal(ledger.stopped(), null);
});

test('missing print platform blocks PRINT only, keeping ordinary independent work available', () => {
  const ledger = createV2ExecutionLedger(make(), identity()); const name = 'final-saved-report-a4';
  ledger.claimPrint(name, identity()); ledger.settlePrint(name, { scope: identity(), outcome: 'blocked', code: 'HEADFUL_PRINT_UNAVAILABLE' });
  ledger.markCaseBlocked('PRINT-01', 'HEADFUL_PRINT_UNAVAILABLE');
  assert.equal(ledger.stopped(), null); settle(ledger);
  ledger.beginCase('AI-S1-01', identity()); ledger.markCasePassed('AI-S1-01', caseProof('AI-S1-01'));
  assert.equal(ledger.summary().cases.find(row => row.caseId === 'AI-S1-01').status, 'PASSED');
  assert.equal(ledger.summary().prints.find(row => row.name === name).status, 'BLOCKED');
  assert.equal(ledger.summary().fullAcceptancePassed, false);
});

test('case pass requires actual UI/assertions/server readback/refresh/three actual screenshot receipts', () => {
  const ledger = createV2ExecutionLedger(make(), identity()); settle(ledger);
  ledger.beginCase('AI-S1-01', identity()); const evidence = caseProof('AI-S1-01');
  for (const patch of [{ actualUiActions: 0 }, { assertionResults: [] }, { assertionResults: [{ id: 'actual-action', passed: true, evidenceSha256: hash }] }]) assert.throws(() => ledger.markCasePassed('AI-S1-01', { ...evidence, ...patch }), /V2_CASE_ASSERTIONS_REQUIRED/);
  assert.throws(() => ledger.markCasePassed('AI-S1-01', { ...evidence, refreshedReadback: { ...evidence.refreshedReadback, revision: 2 } }), /V2_CASE_REFRESH_MISMATCH/);
  assert.throws(() => ledger.markCasePassed('AI-S1-01', { ...evidence, screenshots: evidence.screenshots.slice(0, 2) }), /V2_CASE_SCREENSHOTS_REQUIRED/);
  assert.throws(() => ledger.markCasePassed('AI-S1-01', { ...evidence, elementExists: true }), /V2_CASE_EVIDENCE_INVALID/);
  ledger.markCasePassed('AI-S1-01', evidence);
  assert.equal(ledger.summary().cases.filter(row => row.status === 'PASSED').length, 1);
  assert.equal(ledger.summary().cases.filter(row => row.status === 'NOT_RUN').length, 111);
  assert.equal(ledger.summary().fullAcceptancePassed, false);
});

test('PRINT cases cannot omit the output manifest or claim PDF merely from beforeprint or page.pdf', () => {
  const absent = fixture(); absent.formalOutputs[0].caseIds = ['AI-S1-01']; assert.throws(() => make(absent), /V2_CASE_PRINT_OPERATION_MISSING/);
  for (const patch of [{ systemDialogObserved: false }, { realSystemSavedFile: false }, { headless: true }, { kiosk: true }, { usedPagePdf: true }, { independentlyInspectedAllPages: false }, { contentVerified: false }, { paginationVerified: false }]) {
    const ledger = createV2ExecutionLedger(make(), identity());
    assert.throws(() => finishPrint(ledger, 'final-saved-report-a4', 'A4', patch), /V2_PRINT_SYSTEM_PROOF_REQUIRED/);
  }
});

test('every PDF page must match UI-selected physical paper, be independently rendered and unclipped', () => {
  for (const badPage of [{ widthMm: 210, heightMm: 297, renderSha256: hash, textSha256: hash, clipped: false, contentVerified: true },
    { widthMm: 594, heightMm: 841, renderSha256: hash, textSha256: hash, clipped: true, contentVerified: true }]) {
    const ledger = createV2ExecutionLedger(make(), identity()), proof = printProof('A1'); proof.pages[1] = badPage;
    assert.throws(() => finishPrint(ledger, 'final-saved-report-a1', 'A1', proof), /V2_PRINT_PAGE_PROOF_INVALID/);
  }
  const ledger = createV2ExecutionLedger(make(), identity());
  for (const paper of V2_PAPERS) finishPrint(ledger, `final-saved-report-${paper.toLowerCase()}`, paper);
  settle(ledger, 'actual-ui-s6'); ledger.beginCase('PRINT-01', identity()); ledger.markCasePassed('PRINT-01', caseProof('PRINT-01'));
  assert.equal(ledger.summary().cases.find(row => row.caseId === 'PRINT-01').status, 'PASSED');
  assert.throws(() => ledger.claimPrint('final-saved-report-a1', identity()), /V2_PRINT_ALREADY_CONSUMED/);
  assert.throws(() => ledger.claimPrint('unreviewed-seventeenth-pdf-a4', identity()), /V2_PRINT_NOT_PLANNED/);
});

test('ledger refuses changed manifests and exported summaries are detached from live state', () => {
  const plan = structuredClone(make()); plan.limits.logicalModelActions++;
  assert.throws(() => createV2ExecutionLedger(plan, identity()), /V2_PLAN_CHANGED/);
  const ledger = createV2ExecutionLedger(make(), identity()), snapshot = ledger.summary();
  snapshot.cases[0].status = 'PASSED'; snapshot.limits.nativePdfFiles = 999;
  assert.equal(ledger.summary().cases[0].status, 'NOT_RUN'); assert.equal(ledger.summary().limits.nativePdfFiles, 3);
});

test('budget ledger module does not authorize HTTP calls or synthesize model/PDF output', () => {
  const sourceText = readFileSync(new URL('../../apps/web/e2e/support/devapp-aidt-v2-profile.mjs', import.meta.url), 'utf8');
  assert.equal(/\bfetch\s*\(|page\.pdf\s*\(|route\.continue\s*\(/.test(sourceText), false);
});


test('case timing starts before UI and cannot be backfilled or extended after the deadline', () => {
  const input = fixture(); input.caseBindings[0].timeoutMs = 901000; assert.throws(() => make(input), /V2_CASE_TIMEOUT_BOUND/);
  let tick = 100; const plan = make(), ledger = createV2ExecutionLedger(plan, identity(), () => tick); settle(ledger);
  assert.throws(() => ledger.markCasePassed('AI-S1-01', caseProof('AI-S1-01')), /V2_CASE_EVIDENCE_INVALID/);
  ledger.beginCase('AI-S1-01', identity()); assert.throws(() => ledger.beginCase('AI-S1-01', identity()), /V2_CASE_ALREADY_STARTED/);
  tick += 480001; assert.throws(() => ledger.markCasePassed('AI-S1-01', caseProof('AI-S1-01')), /V2_CASE_TIMEOUT/);
  assert.equal(ledger.summary().cases[0].status, 'FAILED'); assert.equal(ledger.summary().fullAcceptancePassed, false);
});

test('an actual failed assertion remains FAILED with its own receipt and is not relabeled blocked or green', () => {
  const ledger = createV2ExecutionLedger(make(), identity()); ledger.beginCase('AI-S2-14', identity());
  ledger.markCaseFailed('AI-S2-14', { scope: identity(), code: 'WRONG_STAGE_ENTITY_KIND', evidenceSha256: hash });
  assert.equal(ledger.summary().cases.find(row => row.caseId === 'AI-S2-14').status, 'FAILED');
  assert.throws(() => ledger.markCaseBlocked('AI-S2-14', 'DEFERRED'), /V2_CASE_BLOCK_INVALID/);
  assert.throws(() => ledger.markCasePassed('AI-S2-14', caseProof('AI-S2-14')), /V2_CASE_EVIDENCE_INVALID/);
});


test('same-project evidence still cannot pass a later stage with only an earlier-stage operation or model run', () => {
  const wrong = fixture(); const binding = wrong.caseBindings.find(row => row.caseId === 'AI-S6-16');
  const old = wrong.operations.find(row => row.id === binding.operationIds[0]); old.caseIds = old.caseIds.filter(id => id !== binding.caseId);
  wrong.operations.find(row => row.id === 'actual-model-s1').caseIds.push(binding.caseId); binding.operationIds = ['actual-model-s1'];
  assert.throws(() => make(wrong), /V2_CASE_STAGE_OPERATION_MISSING/);
  const ledger = createV2ExecutionLedger(make(), identity()); settle(ledger); ledger.beginCase('AI-S1-01', identity());
  const evidence = caseProof('AI-S1-01'); evidence.serverReadback.entityRole = 'other-entity'; evidence.refreshedReadback.entityRole = 'other-entity';
  assert.throws(() => ledger.markCasePassed('AI-S1-01', evidence), /V2_CASE_ENTITY_ROLE_MISMATCH/);
});
