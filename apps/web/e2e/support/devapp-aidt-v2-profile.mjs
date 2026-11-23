/**
 * Independent V2 acceptance accounting. This module NEVER grants an HTTP or tool
 * permission: the existing authorization guard must also accept every request.
 * Baseline limits and baseline print conversion deliberately live in their old
 * modules. A new profile is a separate, closed operation/output manifest.
 */
import { createHash } from 'node:crypto';
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';

export const BASELINE_PROFILE = 'baseline';
export const V2_VOICE_PROFILE = 'v2-voice-20261122';
export const V2_MANUAL_PATH = 'docs/evidence/aidt-native/completion-20261116/a6/aidt-v2-human-acceptance.md';
const range = (prefix, first, last) => Array.from({ length: last - first + 1 }, (_, i) => `${prefix}${String(first + i).padStart(2, '0')}`);
export const V2_CASE_IDS = Object.freeze([
  ...range('AI-S1-', 1, 12), ...range('AI-S2-', 1, 15), ...range('AI-S3-', 1, 16),
  ...range('AI-S4-', 1, 11), ...range('AI-S4-', 14, 17), ...range('AI-S5-', 1, 16),
  ...range('AI-S6-', 1, 17), ...range('CRUD-', 1, 10), ...range('PRINT-', 1, 11),
]);
export const V2_OPERATION_KINDS = Object.freeze(['ui', 'read', 'write', 'teaching', 'design', 'asr', 'survey', 'research']);
export const V2_PAPERS = Object.freeze(['A4', 'A3', 'A1']);
export const V2_REQUIRED_REAL_MODEL_CASE_IDS = Object.freeze([
  'AI-S1-04', 'AI-S1-11', 'AI-S2-04', 'AI-S3-04', 'AI-S3-10', 'AI-S3-13',
  'AI-S4-04', 'AI-S4-15', 'AI-S5-04', 'AI-S5-16', 'AI-S6-04', 'AI-S6-14', 'AI-S6-16',
]);
const MODEL_CASES = new Set(V2_REQUIRED_REAL_MODEL_CASE_IDS);
const CASES = new Set(V2_CASE_IDS), KINDS = new Set(V2_OPERATION_KINDS), PAPERS = new Set(V2_PAPERS);
const ID = /^[a-z][a-z0-9-]{0,119}$/, SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const PROJECT = /^prj-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const SCOPE_KEYS = ['source', 'controlSource', 'tag', 'run', 'attempt', 'orgId', 'actorId', 'orgRole', 'projectId'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw new ProbeFailure(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function keys(value, required, optional = []) {
  return object(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function strings(values, pattern, maximum, minimum = 1) {
  return Array.isArray(values) && values.length >= minimum && values.length <= maximum
    && values.every(value => typeof value === 'string' && pattern.test(value)) && new Set(values).size === values.length;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function unique(values, code) { if (new Set(values).size !== values.length) fail(code); }
function validCaseIds(ids) { return strings(ids, /^(?:AI-S[1-6]-\d{2}|CRUD-\d{2}|PRINT-\d{2})$/, V2_CASE_IDS.length) && ids.every(id => CASES.has(id)); }

/** Explicit opt-in only; unrecognized/empty values cannot accidentally run a new profile. */
export function acceptanceProfile(env = process.env) {
  const choice = env.AIDT_ACCEPTANCE_PROFILE;
  if (choice === undefined) return BASELINE_PROFILE;
  if (![BASELINE_PROFILE, V2_VOICE_PROFILE].includes(choice)) fail('ACCEPTANCE_PROFILE_INVALID');
  if (choice === V2_VOICE_PROFILE && env.AIDT_ENTRY_DIAGNOSTIC_ONLY === 'true') fail('V2_PROFILE_DIAGNOSTIC_CONFLICT');
  return choice;
}

/**
 * Limits are a SUM of named real operations, not writable numeric allowances.
 * Every output expands to one real-system-save job for each physical paper.
 * The caller owns the reviewed catalog; no baseline result is imported here.
 */
export function buildV2ExecutionPlan(input) {
  if (!keys(input, ['operations', 'formalOutputs', 'caseBindings'])) fail('V2_PLAN_SCHEMA_INVALID');
  if (!Array.isArray(input.operations) || !input.operations.length || input.operations.length > 2048
      || !Array.isArray(input.formalOutputs) || !input.formalOutputs.length || input.formalOutputs.length > 128
      || !Array.isArray(input.caseBindings) || input.caseBindings.length !== V2_CASE_IDS.length) fail('V2_PLAN_BOUND_OR_COVERAGE_INVALID');
  const operations = input.operations.map(row => {
    if (!keys(row, ['id', 'kind', 'stage', 'entityRole', 'caseIds']) || !ID.test(row.id ?? '') || !KINDS.has(row.kind)
        || !Number.isInteger(row.stage) || row.stage < 1 || row.stage > 6 || !ID.test(row.entityRole ?? '') || !validCaseIds(row.caseIds)) fail('V2_OPERATION_SCHEMA_INVALID');
    return { id: row.id, kind: row.kind, stage: row.stage, entityRole: row.entityRole, caseIds: [...row.caseIds].sort() };
  });
  unique(operations.map(row => row.id), 'V2_OPERATION_DUPLICATE');
  const opMap = new Map(operations.map(row => [row.id, row]));
  const formalOutputs = input.formalOutputs.map(row => {
    if (!keys(row, ['name', 'stage', 'entityRole', 'caseIds', 'defaultPaper']) || !ID.test(row.name ?? '') || !ID.test(row.entityRole ?? '')
        || !Number.isInteger(row.stage) || row.stage < 1 || row.stage > 6 || !validCaseIds(row.caseIds) || !PAPERS.has(row.defaultPaper)) fail('V2_FORMAL_OUTPUT_SCHEMA_INVALID');
    return { name: row.name, stage: row.stage, entityRole: row.entityRole, caseIds: [...row.caseIds].sort(), defaultPaper: row.defaultPaper };
  });
  unique(formalOutputs.map(row => row.name), 'V2_FORMAL_OUTPUT_DUPLICATE');
  const printJobs = formalOutputs.flatMap(row => V2_PAPERS.map(paper => ({ name: `${row.name}-${paper.toLowerCase()}`, outputName: row.name,
    stage: row.stage, entityRole: row.entityRole, paper, caseIds: [...row.caseIds], defaultPaper: row.defaultPaper })));
  unique(printJobs.map(row => row.name), 'V2_PRINT_JOB_DUPLICATE');
  const bindings = input.caseBindings.map(row => {
    if (!keys(row, ['caseId', 'operationIds', 'assertionIds'], ['requiresModel', 'requiresPrint', 'timeoutMs']) || !CASES.has(row.caseId)
        || !strings(row.operationIds, ID, operations.length) || !strings(row.assertionIds, ID, 64)
        || ['requiresModel', 'requiresPrint'].some(key => row[key] !== undefined && typeof row[key] !== 'boolean')) fail('V2_CASE_BINDING_INVALID');
    if (row.timeoutMs !== undefined && (!Number.isInteger(row.timeoutMs) || row.timeoutMs < 1000 || row.timeoutMs > 900000)) fail('V2_CASE_TIMEOUT_BOUND');
    if (row.operationIds.some(id => !opMap.has(id) || !opMap.get(id).caseIds.includes(row.caseId))) fail('V2_CASE_OPERATION_MISMATCH');
    const caseStage = /^AI-S([1-6])-/.exec(row.caseId)?.[1];
    if (caseStage && !row.operationIds.some(id => opMap.get(id).stage === Number(caseStage))) fail('V2_CASE_STAGE_OPERATION_MISSING');
    const modelAction = row.operationIds.some(id => ['teaching', 'design', 'asr', 'research'].includes(opMap.get(id).kind));
    if (MODEL_CASES.has(row.caseId) && !row.operationIds.some(id => ['teaching', 'design', 'asr', 'research'].includes(opMap.get(id).kind) && opMap.get(id).stage === Number(caseStage))) fail('V2_CASE_MODEL_STAGE_MISMATCH');
    if ((MODEL_CASES.has(row.caseId) || row.requiresModel) && !modelAction || modelAction && row.requiresModel === false) fail('V2_CASE_MODEL_OPERATION_MISSING');
    if ((row.requiresPrint || row.caseId.startsWith('PRINT-') || row.caseId === 'AI-S3-16') && !printJobs.some(job => job.caseIds.includes(row.caseId))) fail('V2_CASE_PRINT_OPERATION_MISSING');
    return { caseId: row.caseId, operationIds: [...row.operationIds], assertionIds: [...row.assertionIds], requiresModel: modelAction, requiresPrint: row.requiresPrint === true || row.caseId.startsWith('PRINT-') || row.caseId === 'AI-S3-16', timeoutMs: row.timeoutMs ?? (modelAction ? 900000 : row.caseId.startsWith('PRINT-') || row.caseId === 'AI-S3-16' ? 600000 : 480000) };
  });
  unique(bindings.map(row => row.caseId), 'V2_CASE_BINDING_DUPLICATE');
  if (V2_CASE_IDS.some(id => !bindings.some(row => row.caseId === id))) fail('V2_CASE_COVERAGE_MISSING');
  if (operations.some(row => !row.caseIds.every(id => bindings.some(binding => binding.caseId === id && binding.operationIds.includes(row.id))))) fail('V2_OPERATION_CASE_UNBOUND');
  const byKind = Object.fromEntries(V2_OPERATION_KINDS.map(kind => [kind, operations.filter(row => row.kind === kind).length]));
  const plan = { schemaVersion: 1, profile: V2_VOICE_PROFILE, manualPath: V2_MANUAL_PATH,
    caseIds: [...V2_CASE_IDS], operations, formalOutputs, printJobs, caseBindings: bindings,
    limits: { operations: operations.length, ...byKind, physicalMutationRequests: operations.filter(row => !['ui', 'read'].includes(row.kind)).length,
      logicalModelActions: operations.filter(row => ['teaching', 'design', 'asr', 'research'].includes(row.kind)).length,
      nativePdfFiles: printJobs.length, automaticUnknownRetries: 0 } };
  return freeze({ ...plan, manifestSha256: digest(plan) });
}
export const buildV2Plan = buildV2ExecutionPlan;

function assertScope(scope) {
  if (!keys(scope, SCOPE_KEYS) || !SHA.test(scope.source ?? '') || !SHA.test(scope.controlSource ?? '')
      || !/^[0-9]+-[0-9]+$/.test(scope.tag ?? '') || !/^[1-9][0-9]*$/.test(scope.run ?? '') || !/^[1-9][0-9]*$/.test(scope.attempt ?? '')
      || !SAFE_ID.test(scope.orgId ?? '') || !SAFE_ID.test(scope.actorId ?? '') || scope.orgRole !== 'consultant' || !PROJECT.test(scope.projectId ?? '')) fail('V2_RUNTIME_SCOPE_INVALID');
  return Object.fromEntries(SCOPE_KEYS.map(key => [key, scope[key]]));
}
export function assertV2RuntimeIdentity(expected, observed) {
  const binding = assertScope(expected), current = assertScope(observed);
  if (!same(binding, current)) fail('V2_RUNTIME_IDENTITY_CHANGED');
  return freeze(binding);
}

function assertFile(row, extension) {
  if (!keys(row, ['filename', 'sha256', 'bytes'], ['kind']) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(row.filename ?? '')
      || row.kind !== undefined && !['before', 'result', 'refreshed', 'system-dialog', 'pdf-render'].includes(row.kind)
      || !row.filename.endsWith(extension) || !HASH.test(row.sha256 ?? '') || !Number.isSafeInteger(row.bytes) || row.bytes < 512 || row.bytes > 33554432) fail('V2_EVIDENCE_FILE_INVALID');
  return { filename: row.filename, sha256: row.sha256, bytes: row.bytes, ...(row.kind ? { kind: row.kind } : {}) };
}
function assertReadback(value, identity) {
  if (!keys(value, ['projectId', 'entityRole', 'revision', 'contentSha256']) || value.projectId !== identity.projectId || !ID.test(value.entityRole ?? '')
      || !Number.isSafeInteger(value.revision) || value.revision < 0 || !HASH.test(value.contentSha256 ?? '')) fail('V2_CASE_READBACK_REQUIRED');
  return { ...value };
}

/** All methods validate first. Unknown remote outcomes lock the whole mutation ledger. */
export function createV2ExecutionLedger(plan, expectedIdentity, now = Date.now) {
  if (!plan || plan.profile !== V2_VOICE_PROFILE || typeof plan.manifestSha256 !== 'string') fail('V2_PLAN_REQUIRED');
  const { manifestSha256, ...base } = plan;
  if (digest(base) !== manifestSha256) fail('V2_PLAN_CHANGED');
  const identity = assertScope(expectedIdentity), operationMap = new Map(plan.operations.map(row => [row.id, row]));
  const statuses = new Map(plan.operations.map(row => [row.id, { status: 'NOT_RUN' }]));
  const cases = new Map(V2_CASE_IDS.map(id => [id, { caseId: id, status: 'NOT_RUN' }]));
  const prints = new Map(plan.printJobs.map(job => [job.name, { status: 'NOT_RUN' }]));
  const bindings = new Map(plan.caseBindings.map(row => [row.caseId, row]));
  let stopped = null;
  const check = observed => assertV2RuntimeIdentity(identity, observed);
  const live = () => { if (stopped) fail(stopped); };
  const operation = id => { const row = operationMap.get(id); if (!row) fail('V2_OPERATION_NOT_PLANNED'); return row; };
  function claimOperation(id, observed) {
    live(); check(observed); operation(id);
    if (statuses.get(id).status !== 'NOT_RUN') fail('V2_OPERATION_ALREADY_CONSUMED');
    statuses.set(id, { status: 'CLAIMED', claimedAt: now() });
    return freeze({ operationId: id, manifestSha256, scope: { ...identity } });
  }
  function markOperationSent(id, observed) {
    live(); check(observed); operation(id);
    const previous = statuses.get(id);
    if (previous.status !== 'CLAIMED') fail('V2_OPERATION_NOT_CLAIMED');
    statuses.set(id, { ...previous, status: 'SENT', sentAt: now() });
  }
  function settleOperation(id, result) {
    check(result?.scope); const row = operation(id), previous = statuses.get(id);
    if (previous.status !== 'SENT' || !['succeeded', 'failed', 'unknown'].includes(result.outcome)) fail('V2_OPERATION_SETTLEMENT_INVALID');
    if (result.outcome === 'unknown') {
      statuses.set(id, { ...previous, status: 'UNKNOWN', settledAt: now() });
      if (!['ui', 'read'].includes(row.kind)) stopped ??= 'V2_UNKNOWN_MUTATION_OUTCOME';
      return;
    }
    if (!keys(result.receipt, ['verified', 'sha256'], ['httpStatus']) || result.receipt.verified !== true || !HASH.test(result.receipt.sha256 ?? '')
        || result.receipt.httpStatus !== undefined && (!Number.isInteger(result.receipt.httpStatus) || result.receipt.httpStatus < 100 || result.receipt.httpStatus > 599)) fail('V2_OPERATION_RECEIPT_INVALID');
    statuses.set(id, { ...previous, status: result.outcome === 'succeeded' ? 'SUCCEEDED' : 'FAILED', settledAt: now(), receipt: { ...result.receipt } });
  }
  function claimPrint(name, observed) {
    live(); check(observed);
    if (!prints.has(name)) fail('V2_PRINT_NOT_PLANNED');
    if (prints.get(name).status !== 'NOT_RUN') fail('V2_PRINT_ALREADY_CONSUMED');
    prints.set(name, { status: 'CLAIMED', claimedAt: now() });
    return plan.printJobs.find(job => job.name === name);
  }
  function settlePrint(name, result) {
    check(result?.scope);
    if (!prints.has(name) || prints.get(name).status !== 'CLAIMED') fail('V2_PRINT_NOT_CLAIMED');
    if (result.outcome === 'blocked') {
      if (!/^[A-Z0-9_]{1,90}$/.test(result.code ?? '')) fail('V2_PRINT_BLOCK_REASON_INVALID');
      prints.set(name, { status: 'BLOCKED', code: result.code, finishedAt: now() }); return;
    }
    const job = plan.printJobs.find(row => row.name === name), proof = result.proof;
    if (result.outcome !== 'succeeded' || !keys(proof, ['paper', 'systemDialogObserved', 'explicitApplicationPrint', 'realSystemSavedFile', 'headless', 'kiosk', 'usedPagePdf', 'independentlyInspectedAllPages', 'contentVerified', 'paginationVerified', 'pageCount', 'pages']) || proof.paper !== job.paper || proof.systemDialogObserved !== true || proof.explicitApplicationPrint !== true
        || proof.realSystemSavedFile !== true || proof.headless !== false || proof.kiosk !== false || proof.usedPagePdf !== false
        || proof.independentlyInspectedAllPages !== true || proof.contentVerified !== true || proof.paginationVerified !== true
        || !Number.isSafeInteger(proof.pageCount) || proof.pageCount < 1 || proof.pageCount > 100 || !Array.isArray(proof.pages) || proof.pages.length !== proof.pageCount) fail('V2_PRINT_SYSTEM_PROOF_REQUIRED');
    const dimensions = { A4: [210, 297], A3: [297, 420], A1: [594, 841] }[job.paper];
    for (const page of proof.pages) {
      if (!keys(page, ['widthMm', 'heightMm', 'renderSha256', 'textSha256', 'clipped', 'contentVerified']) || !Number.isFinite(page.widthMm) || !Number.isFinite(page.heightMm) || !HASH.test(page.renderSha256 ?? '')
          || !HASH.test(page.textSha256 ?? '') || page.clipped !== false || page.contentVerified !== true
          || ![dimensions, [...dimensions].reverse()].some(([w, h]) => Math.abs(w - page.widthMm) <= 1 && Math.abs(h - page.heightMm) <= 1)) fail('V2_PRINT_PAGE_PROOF_INVALID');
    }
    const file = assertFile(result.file, '.pdf');
    if (!file.filename.includes(name)) fail('V2_PRINT_FILENAME_MISMATCH');
    prints.set(name, { status: 'SUCCEEDED', finishedAt: now(), file, proof: { ...proof, pages: proof.pages.map(row => ({ ...row })) } });
  }
  function beginCase(caseId, observed) {
    live(); check(observed);
    const binding = bindings.get(caseId);
    if (!binding || cases.get(caseId).status !== 'NOT_RUN') fail('V2_CASE_ALREADY_STARTED');
    const startedAt = now(); cases.set(caseId, { caseId, status: 'RUNNING', startedAt, deadlineAt: startedAt + binding.timeoutMs });
  }
  function markCaseFailed(caseId, result) {
    check(result?.scope);
    if (!cases.has(caseId) || cases.get(caseId).status !== 'RUNNING' || !/^[A-Z0-9_]{1,90}$/.test(result.code ?? '') || !HASH.test(result.evidenceSha256 ?? '')) fail('V2_CASE_FAILURE_INVALID');
    cases.set(caseId, { ...cases.get(caseId), status: 'FAILED', code: result.code, evidenceSha256: result.evidenceSha256, finishedAt: now() });
  }
  function markCaseBlocked(caseId, code) {
    if (!cases.has(caseId) || !/^[A-Z0-9_]{1,90}$/.test(code ?? '') || ['PASSED', 'FAILED'].includes(cases.get(caseId).status)) fail('V2_CASE_BLOCK_INVALID');
    cases.set(caseId, { caseId, status: 'BLOCKED', code });
  }
  function markCasePassed(caseId, evidence) {
    live(); check(evidence?.scope);
    const binding = bindings.get(caseId);
    if (!binding || cases.get(caseId).status !== 'RUNNING' || !keys(evidence, ['scope', 'actualUiActions', 'assertionResults', 'serverReadback', 'refreshedReadback', 'screenshots'], ['realModelReceipt'])) fail('V2_CASE_EVIDENCE_INVALID');
    if (now() > cases.get(caseId).deadlineAt) {
      cases.set(caseId, { ...cases.get(caseId), status: 'FAILED', code: 'V2_CASE_TIMEOUT', finishedAt: now() }); fail('V2_CASE_TIMEOUT');
    }
    if (!Number.isInteger(evidence.actualUiActions) || evidence.actualUiActions < 1 || evidence.actualUiActions > (caseId === 'CRUD-02' ? 256 : 128)
        || !Array.isArray(evidence.assertionResults) || evidence.assertionResults.length !== binding.assertionIds.length
        || !binding.assertionIds.every(id => evidence.assertionResults.some(row => keys(row, ['id', 'passed', 'evidenceSha256']) && row.id === id && row.passed === true && HASH.test(row.evidenceSha256 ?? '')))) fail('V2_CASE_ASSERTIONS_REQUIRED');
    if (binding.operationIds.some(id => statuses.get(id)?.status !== 'SUCCEEDED')) fail('V2_CASE_OPERATIONS_INCOMPLETE');
    const readback = assertReadback(evidence.serverReadback, identity), refreshed = assertReadback(evidence.refreshedReadback, identity);
    if (!same(readback, refreshed)) fail('V2_CASE_REFRESH_MISMATCH');
    if (!binding.operationIds.some(id => operationMap.get(id).entityRole === readback.entityRole)) fail('V2_CASE_ENTITY_ROLE_MISMATCH');
    if (!Array.isArray(evidence.screenshots) || evidence.screenshots.length < 3 || evidence.screenshots.length > 8) fail('V2_CASE_SCREENSHOTS_REQUIRED');
    const screenshots = evidence.screenshots.map(row => assertFile(row, '.png'));
    if (new Set(screenshots.map(row => row.filename)).size !== screenshots.length) fail('V2_CASE_SCREENSHOTS_REQUIRED');
    if (!['before', 'result', 'refreshed'].every(kind => screenshots.some(row => row.kind === kind && row.filename.includes(caseId)))) fail('V2_CASE_SCREENSHOTS_REQUIRED');
    if (binding.requiresModel && (!keys(evidence.realModelReceipt, ['runId', 'threadId', 'stageId', 'sourceRevision', 'providerObserved', 'substitute', 'settled'])
        || !Number.isInteger(evidence.realModelReceipt.stageId) || !binding.operationIds.some(id => operationMap.get(id).stage === evidence.realModelReceipt.stageId && ['teaching', 'design', 'asr', 'research'].includes(operationMap.get(id).kind))
        || !SAFE_ID.test(evidence.realModelReceipt.runId ?? '') || !SAFE_ID.test(evidence.realModelReceipt.threadId ?? '') || evidence.realModelReceipt.sourceRevision !== identity.source
        || evidence.realModelReceipt.providerObserved !== true || evidence.realModelReceipt.substitute !== false || evidence.realModelReceipt.settled !== true)) fail('V2_CASE_REAL_MODEL_REQUIRED');
    if (binding.requiresPrint && plan.printJobs.filter(job => job.caseIds.includes(caseId)).some(job => prints.get(job.name)?.status !== 'SUCCEEDED')) fail('V2_CASE_PRINTS_INCOMPLETE');
    cases.set(caseId, { ...cases.get(caseId), caseId, status: 'PASSED', verifiedAt: now(), operationIds: [...binding.operationIds], assertionIds: [...binding.assertionIds], serverReadback: readback,
      screenshots, ...(binding.requiresModel ? { realModelReceipt: { ...evidence.realModelReceipt } } : {}) });
  }
  function summary() {
    return { profile: V2_VOICE_PROFILE, manifestSha256, scope: { ...identity }, limits: { ...plan.limits }, fatal: stopped,
      operations: [...statuses].map(([id, row]) => ({ id, ...structuredClone(row) })),
      cases: [...cases.values()].map(row => structuredClone(row)), prints: [...prints].map(([name, row]) => ({ name, ...structuredClone(row) })),
      fullAcceptancePassed: !stopped && [...cases.values()].every(row => row.status === 'PASSED') && [...prints.values()].every(row => row.status === 'SUCCEEDED') };
  }
  return Object.freeze({ claimOperation, markOperationSent, markOperationStarted: markOperationSent, settleOperation, claimPrint, settlePrint, beginCase, markCaseFailed, markCaseBlocked, markCasePassed, summary, stopped: () => stopped });
}
