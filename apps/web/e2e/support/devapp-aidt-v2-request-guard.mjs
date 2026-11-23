/** Independent V2 profile request controller. Baseline module and its limits are untouched. */
import { ORIGIN, ProbeFailure, validLoginBody } from './devapp-aidt-auth-readonly.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { V2_VOICE_PROFILE, isNamedAcceptanceProfile, assertV2RuntimeIdentity } from './devapp-aidt-v2-profile.mjs';
import { validateTeachingScope, validateTeachingWire, identifyOwnedTeachingRun, decideOwnedTeachingExecutionRead, brainstormRecord, validBrainstormProjection, validTestPlanProjection, ENTITY } from './devapp-aidt-chat-evidence.mjs';

import { CASE01_PROFILE, CASE01_LIMITS, assertCase01Plan } from './devapp-aidt-case01-plan.mjs';
import { createCase01StageFiles } from './devapp-aidt-case01-stage-files.mjs';

export const SHA = /^[a-f0-9]{40}$/;
export const TAG = /^[0-9]+-[0-9]+$/;
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export const PROJECT = new RegExp(`^prj-${UUID}$`);
export { ENTITY };
const MAX_BODY = 1048576;
const ROOTS = new Set(['fields', 'ideas', 'selectedIdeaId', 'discoveryCards', 'selectionReasons', 'unboundReason']);
const HOME_IMAGES = new Set(['/aidt/design-thinking-school.png', '/aidt/workshop-materials.png']);
export function approvedHomeImage(target) {
  if (HOME_IMAGES.has(target.pathname)) return !target.search;
  return target.pathname === '/_next/image' && [...target.searchParams.keys()].sort().join(',') === 'q,url,w'
    && HOME_IMAGES.has(target.searchParams.get('url')) && target.searchParams.get('q') === '75'
    && ['128','256','384','640','750','828','1080','1200','1920'].includes(target.searchParams.get('w'));
}

export function assertAcceptanceWorkflow(env) {
  if (env.GITHUB_REPOSITORY !== 'boardx/workspacex' || env.GITHUB_REF !== 'refs/heads/develop' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || !SHA.test(env.GITHUB_SHA ?? '')) throw new ProbeFailure('MANUAL_DEVELOP_WORKFLOW_REQUIRED');
}

export function acceptanceIdentity(env) {
  const { EXPECTED_SOURCE_SHA: source, EXPECTED_RELEASE_TAG: tag, GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt } = env;
  if (!SHA.test(source ?? '') || !TAG.test(tag ?? '') || !/^[1-9][0-9]*$/.test(run ?? '') || !/^[1-9][0-9]*$/.test(attempt ?? '')) throw new ProbeFailure('ACCEPTANCE_IDENTITY_INVALID');
  return { source, tag, run, attempt, entryDiagnosticOnly: env.AIDT_ENTRY_DIAGNOSTIC_ONLY === 'true', projectName: `AIDT QA synthetic ${run}-${attempt}` };
}

export function assertRuntimeProof(proof, identity) {
  const exact = proof?.aidtExactRelease;
  if (exact?.status !== 'OBSERVED' || !Array.isArray(exact.containers)) throw new ProbeFailure('EXACT_RUNTIME_UNVERIFIED');
  const roles = new Set();
  for (const item of exact.containers) {
    if (item.sourceRevision !== identity.source || item.tag !== identity.tag || !/^sha256:[a-f0-9]{64}$/.test(item.imageId ?? '')) throw new ProbeFailure('EXACT_RUNTIME_MISMATCH');
    roles.add(item.role);
  }
  if (!['api', 'web', 'agent', 'sandbox'].every(role => roles.has(role))) throw new ProbeFailure('EXACT_RUNTIME_ROLES_MISSING');
  return { source: identity.source, tag: identity.tag, containers: exact.containers.map(({ role, sourceRevision, tag, imageId }) => ({ role, sourceRevision, tag, imageId })) };
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
const exactKeys = (value, names) => object(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
const canonicalValue = value => Array.isArray(value) ? value.map(canonicalValue) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])])) : value;
const contentHash = value => createHash('sha256').update(value === undefined ? 'undefined' : JSON.stringify(canonicalValue(value))).digest('hex');
const REQUEST_KINDS = new Map([
  ['stage-save', 'write'], ['entity-thread', 'write'], ['thread-create', 'write'], ['thread-mount', 'write'], ['reconcile-entity', 'write'],
  ['teaching-send', 'teaching'], ['design-create', 'write'], ['design-link', 'write'], ['design-generate', 'design'], ['design-image', 'write'], ['design-ref-image','write'],
  ['upload', 'write'], ['chat-audio-upload', 'write'], ['chat-stage-text-upload', 'write'], ['asr-file', 'asr'], ['asr-permission-once', 'write'], ['research-create', 'write'], ['research-initialize', 'write'], ['research-save', 'write'],
  ['research-confirm', 'write'], ['research-generate', 'research'], ['research-execute', 'research'],
  ['survey-proposal', 'research'], ['survey-create', 'survey'], ['survey-source', 'survey'], ['survey-link', 'survey'], ['survey-publish', 'survey'], ['survey-submit', 'survey'], ['survey-close', 'survey'], ['survey-report','write'],
]);
export const V2_REQUEST_KINDS = Object.freeze([...REQUEST_KINDS.keys()]);
// Frozen product action vocabulary, never arbitrary caller-provided prefix matching.
export const V2_NATIVE_ACTION_STAGES = Object.freeze({
  '[AIDT:FRAME:PROBLEM-CANDIDATES:1]': 1, '[AIDT:INTERVIEW:DISCOVERY-CANDIDATES:1]': 2,
  '[AIDT:DEFINE:PERSONA-CANDIDATES:1]': 3, '[AIDT:DEFINE:HMW-CANDIDATES:1]': 3,
  '[AIDT:IDEATE:IDEA-CANDIDATES:1]': 4, '[AIDT:PROTOTYPE:TEXT-CANDIDATES:1]': 5, '[AIDT:TEST:LEARNING-CANDIDATES:1]': 6,
});

/** Pure evidence check; the guard supplies observations, never caller-provided run authority. */
export function assertV2AsrOnceEvidence(facts) {
  const { stageId, entityRole, entityId, projectId, permission, entry, observed, review, now } = facts;
  const fail = () => { throw new ProbeFailure('V2_ASR_PERMISSION_UNVERIFIED'); };
  const tool = permission?.toolName, suffix = tool === 'wx_audio_transcribe' ? 'audio' : tool === 'wx_artifact_publish' ? 'publish' : null;
  const expectedRole = stageId === 2 ? 'source-interview' : stageId === 6 ? 'test-offline' : null;
  if (!suffix || entityRole !== expectedRole || !expectedRole || !ENTITY.test(entityId ?? '')
    || !exactKeys(permission,['runId','permissionRequestId','toolName','argsSha256','review'])
    || !/^[a-f0-9-]{36}$/.test(permission.permissionRequestId ?? '') || !/^[a-f0-9]{64}$/.test(permission.argsSha256 ?? '')
    || !entry || entry.ticket?.requestKind !== 'asr-file' || entry.scope.stageId !== stageId || entry.scope.projectId !== projectId
    || entry.scope.selector.entityId !== entityId || entry.scope.actorId !== facts.actorId
    || entry.ticket.entityRole !== entityRole || entry.accepted?.runId !== permission.runId || !entry.asrAudio
    || !observed || observed.at > now || now - observed.at > 15000) fail();
  const run = observed.run, pending = run?.pendingApproval, args = pending?.interrupt?.args;
  if (!object(run) || run.runId !== permission.runId || run.threadId !== entry.scope.threadId || run.inputMessageId !== entry.accepted.inputMessageId
    || run.status !== 'awaiting_tool_permission' || pending?.permissionRequestId !== permission.permissionRequestId
    || pending.toolName !== tool || pending.interrupt?.toolName !== tool || !object(args)
    || contentHash(args) !== permission.argsSha256) fail();
  const keys = ['reviewed','reviewerKind','projectId','entityId','threadId','runId','inputMessageId','permissionRequestId','toolName','argsSha256','sourceSha256','reviewedAtMs','expiresAtMs','nonce'];
  if (!exactKeys(review,keys) || permission.review !== review || review.reviewed !== true || review.reviewerKind !== 'agent'
    || review.projectId !== projectId || review.entityId !== entityId || review.threadId !== run.threadId
    || review.runId !== run.runId || review.inputMessageId !== run.inputMessageId || review.permissionRequestId !== pending.permissionRequestId
    || review.toolName !== tool || review.argsSha256 !== permission.argsSha256 || review.sourceSha256 !== entry.asrAudio.sourceSha256
    || !Number.isSafeInteger(review.reviewedAtMs) || !Number.isSafeInteger(review.expiresAtMs) || review.reviewedAtMs > now
    || review.expiresAtMs <= now || review.expiresAtMs <= review.reviewedAtMs || review.expiresAtMs - review.reviewedAtMs > 120000
    || !/^[A-Za-z0-9_-]{16,128}$/.test(review.nonce ?? '')) fail();
  if (tool === 'wx_audio_transcribe') {
    if (Object.keys(args).some(key => !['attachmentId','language','diarization'].includes(key)) || args.attachmentId !== entry.asrAudio.attachmentId
      || args.language !== undefined && (typeof args.language !== 'string' || args.language.length < 1 || args.language.length > 32)
      || args.diarization !== undefined && typeof args.diarization !== 'boolean') fail();
  } else {
    if (!exactKeys(args,['workspacePath','title','mediaType','idempotencyKey']) || args.mediaType !== 'application/json'
      || args.title !== `aidt-asr-${entry.asrAudio.requestId}.json` || !/^[A-Za-z0-9_.:-]{1,128}$/.test(args.idempotencyKey ?? '')) fail();
    if (!Array.isArray(run.steps) || run.steps.length > 256) fail();
    const calls = run.steps.filter(step => {
      try { return step.kind === 'tool_call' && step.status === 'succeeded' && step.toolName === 'wx_audio_transcribe'
        && JSON.parse(step.toolArgsSummary).attachmentId === entry.asrAudio.attachmentId; } catch { return false; }
    });
    if (calls.length !== 1) fail();
    const summary = calls[0].toolResultSummary, prefix = 'audio-transcription-receipt:v1 ';
    if (typeof summary !== 'string' || summary.length > 500 || !summary.startsWith(prefix)
      || createHash('sha256').update(summary).digest('hex') !== calls[0].outputDigest) fail();
    let receipt; try { receipt = JSON.parse(summary.slice(prefix.length)); } catch { fail(); }
    if (!exactKeys(receipt,['status','workspacePath','sha256','sourceHash']) || receipt.status !== 'succeeded'
      || receipt.sourceHash !== entry.asrAudio.sourceSha256 || !/^[a-f0-9]{64}$/.test(receipt.sha256 ?? '')
      || !/^\/workspace\/transcribed-[a-f0-9]{64}\.json$/.test(receipt.workspacePath ?? '') || receipt.workspacePath !== args.workspacePath) fail();
  }
  return { operationId: `s${stageId}-${entityRole}-asr-${suffix}-permission-once`, runId: run.runId,
    permissionRequestId: pending.permissionRequestId, nonce: review.nonce };
}

function createV2SurveyGuard(getTicket, now) {
  let active = false, id, version, token, responseId, linked = false, title, questions = [], groupEntity;
  let publicationVersion, publicationQuestionsHash, publicObserved = null, pendingSubmit = null;
  let latestRuntime = null;
  const submitOperations = new Set(), submissionIds = new Set(), responseIds = new Set();
  const publicReadDecisions = new WeakMap();
  const runtimeReadDecisions = new WeakMap();
  const spent = new Set();
  const fail = () => { throw new ProbeFailure('V2_SURVEY_SCOPE_REJECTED'); };
  const take = kind => { if (spent.has(kind)) fail(); spent.add(kind); return { allow: true, kind }; };
  function decide(method, url, body, projectId, audience) {
    if (!active || !projectId) return;
    const path = url.pathname, ticket = getTicket();
    if (method === 'GET') {
      if (id && path === '/api/surveys/' + id && !url.search) {
        const decision={allow:true,kind:'survey-read'}; runtimeReadDecisions.set(decision,{at:now()}); return decision;
      }
      if (token && !url.search && path === '/surveys/' + token) return { allow: true, kind: 'read' };
      if (token && !url.search && path === '/api/public/surveys/' + token) {
        const decision = { allow: true, kind: 'survey-public-read' };
        // The request channel is recorded out of band, not trusted from a
        // caller-supplied decision property or the public response body.
        publicReadDecisions.set(decision,{audience,at:now()});
        return decision;
      }
      if ((['/studio/survey','/studio/survey/import'].includes(path) || id && ['import','design','publish','responses'].some(part => path === `/studio/survey/${id}/${part}`))
        && url.searchParams.get('projectId') === projectId && [...url.searchParams.keys()].every(key => ['projectId','create','_rsc'].includes(key))) return { allow: true, kind: 'read' };
      return;
    }
    if (url.search) return;
    if (method === 'POST' && path === '/api/surveys/markdown-proposals') {
      if (ticket?.requestKind !== 'survey-proposal' || !exactKeys(body,['text']) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 20000) fail();
      return take('survey-proposal');
    }
    if (method === 'POST' && path === '/api/surveys') {
      const expectedTitle = ticket?.expectedFields?.title;
      if (id || ticket?.requestKind !== 'survey-create' || !exactKeys(body,['questions','tags','template','title']) || body.title !== expectedTitle
        || typeof body.title !== 'string' || !body.title.trim() || body.title.length > 120 || !Array.isArray(body.tags) || body.tags.length > 8
        || !Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > 24 || !object(body.template)
        || !ENTITY.test(body.template.id ?? '') || !Array.isArray(body.template.sections) || body.template.sections.length > 24
        || body.questions.some(question => !object(question) || !ENTITY.test(question.id ?? '') || typeof question.title !== 'string' || !question.title.trim() || question.title.length > 1000
          || !['single','multi','scale','open','dropdown','image_single','image_multi','short','multiple_text','number','date','time','datetime','email','phone','address','cascade','rating','nps','slider','matrix_single','matrix_multi','matrix_scale','matrix_input','matrix_dropdown','ranking','allocation','file','signature','description','page_break'].includes(question.type))
        || new Set(body.questions.map(question => question.id)).size !== body.questions.length) fail();
      title = body.title; questions = structuredClone(body.questions); return take('survey-create');
    }
    if (id && method === 'PUT' && path === `/api/surveys/${id}/source`) {
      if (ticket?.requestKind !== 'survey-source' || !exactKeys(body,['expectedVersion','documents']) || body.expectedVersion !== version
        || !exactKeys(body.documents,['design','publication','reportTemplate']) || Object.values(body.documents).some(value => typeof value !== 'string' || value.length > 262144)) fail();
      return take('survey-source');
    }
    if (id && method === 'POST' && path === `/api/projects/${projectId}/resources` && body?.kind === 'survey') {
      if (ticket?.requestKind !== 'survey-link' || !exactKeys(body,['kind','projectId','resourceId']) || body.projectId !== projectId || body.resourceId !== id) fail();
      return take('survey-link');
    }
    if (id && method === 'POST' && path === `/api/surveys/${id}/publish`) {
      if (ticket?.requestKind !== 'survey-publish' || !linked || !exactKeys(body,['expectedVersion']) || body.expectedVersion !== version) fail();
      return take('survey-publish');
    }
    if (id && method === 'POST' && path === `/api/surveys/${id}/report`) {
      const runtime=latestRuntime?.value;
      if (audience !== undefined || ticket?.operationId !== 's6-test-survey-native-report' || ticket.kind !== 'write' || ticket.requestKind !== 'survey-report'
        || ticket.stageId !== 6 || ticket.entityRole !== 'test-survey' || ticket.entityId !== groupEntity || ticket.resourceId !== id || !linked
        || !exactKeys(body,['expectedVersion']) || !latestRuntime || latestRuntime.at > now() || now() - latestRuntime.at > 15000
        || runtime.id !== id || runtime.version !== version || body.expectedVersion !== runtime.version
        || !Number.isSafeInteger(runtime.answerRevision) || runtime.answerRevision < 1 || responseIds.size !== 8 || pendingSubmit
        || !Array.isArray(runtime.responses) || runtime.responses.length !== 8 || new Set(runtime.responses.map(row=>row.id)).size !== 8
        || runtime.responses.some(row=>!responseIds.has(row.id) || row.analysis !== 'included' || !Array.isArray(row.answers) || row.answers.length !== questions.length)
        || runtime.publication?.token !== token || runtime.publication.version !== publicationVersion
        || contentHash(runtime.publication.questions) !== publicationQuestionsHash) fail();
      const decision=take('survey-report');
      return {...decision,beforeVersion:runtime.version,beforeAnswerRevision:runtime.answerRevision};
    }
    if (token && method === 'POST' && path === `/api/public/surveys/${token}/responses`) {
      const operation = /^s6-test-survey-native-participant-submit-(0[1-8])$/.exec(ticket?.operationId ?? '');
      const expected = ticket?.expectedFields, publication = expected?.surveyPublication;
      if (audience !== 'survey-participant' || ticket?.requestKind !== 'survey-submit' || ticket.stageId !== 6 || ticket.entityRole !== 'test-survey'
        || !operation || Number(operation[1]) !== submitOperations.size + 1 || submitOperations.has(ticket.operationId) || pendingSubmit
        || publicObserved?.audience !== 'survey-participant' || publicObserved.at > now() || now() - publicObserved.at > 15000
        || !exactKeys(expected,['answers','surveyPublication']) || !exactKeys(publication,['surveyId','version','questionsSha256'])
        || publication.surveyId !== id || publication.version !== publicationVersion || publication.questionsSha256 !== publicationQuestionsHash
        || !exactKeys(body,['answers','durationSeconds','submissionId'])
        || !new RegExp(`^${UUID}$`,'i').test(body.submissionId ?? '') || !Number.isInteger(body.durationSeconds) || body.durationSeconds < 0 || body.durationSeconds > 1800
        || submissionIds.has(body.submissionId)
        || !Array.isArray(body.answers) || body.answers.length !== questions.length || new Set(body.answers.map(answer => answer.questionId)).size !== questions.length
        || body.answers.some(answer => !exactKeys(answer,['questionId','value']) || !questions.some(question => question.id === answer.questionId)
          || Buffer.byteLength(JSON.stringify(answer.value)) > 3000) || contentHash(body.answers) !== contentHash(ticket.expectedFields?.answers)) fail();
      submitOperations.add(ticket.operationId); submissionIds.add(body.submissionId); publicObserved = null;
      pendingSubmit = {operationId:ticket.operationId,submissionId:body.submissionId};
      return {allow:true,kind:'survey-submit',operationId:ticket.operationId};
    }
  }
  function observe(decision, status, data) {
    const kind = decision?.kind;
    if (!kind?.startsWith('survey-')) return;
    if (![200,201,204].includes(status)) fail();
    if (kind === 'survey-proposal') {
      if (typeof data?.markdown !== 'string' || !data.markdown.trim() || data.markdown.length > 262144 || !new RegExp(`^${UUID}$`,'i').test(data.execution?.id ?? '')
        || !data.execution?.provider || !data.execution?.modelId || data.source?.kind !== 'text' || !/^[a-f0-9]{64}$/.test(data.source?.sha256 ?? '')) fail();
    } else if (kind === 'survey-create') {
      if (!ENTITY.test(data?.id ?? '') || data.title !== title || data.status !== 'draft' || data.responses?.length !== 0 || data.publication || !Number.isInteger(data.version)) fail();
      id = data.id; version = data.version;
    } else if (kind === 'survey-public-read') {
      const issued = publicReadDecisions.get(decision); publicReadDecisions.delete(decision);
      if (!issued || issued.at > now() || now() - issued.at > 15000 || !token || data?.id !== id || data.version !== publicationVersion || data.alreadySubmitted === true
        || !Array.isArray(data.questions) || contentHash(data.questions) !== publicationQuestionsHash) fail();
      // Owners may read the public schema, but only the actual anonymous
      // participant route may establish a fresh one-submission prerequisite.
      if (issued.audience === 'survey-participant') publicObserved = {audience:issued.audience,at:now()};
    } else if (['survey-read','survey-source'].includes(kind)) {
      if (data?.id !== id || !Number.isInteger(data.version) || data.version < version) fail(); version = data.version;
      if (kind === 'survey-read') {
        const issued=runtimeReadDecisions.get(decision); runtimeReadDecisions.delete(decision);
        if (!issued || issued.at > now() || now() - issued.at > 15000) fail();
        latestRuntime={at:now(),value:structuredClone(data)};
      }
    } else if (kind === 'survey-link') linked = true;
    else if (kind === 'survey-publish') {
      if (data?.id !== id || data.publication?.status !== 'collecting' || !/^[A-Za-z0-9_-]{16,200}$/.test(data.publication.token ?? '')
        || !Number.isSafeInteger(data.publication.version) || data.publication.version < 1
        || !Array.isArray(data.publication.questions) || contentHash(data.publication.questions.map(item=>item.id)) !== contentHash(questions.map(item=>item.id))) fail();
      token = data.publication.token; version = data.version; questions = structuredClone(data.publication.questions);
      publicationVersion = data.publication.version; publicationQuestionsHash = contentHash(questions);
    } else if (kind === 'survey-submit') {
      if (!pendingSubmit || !ENTITY.test(data?.responseId ?? '') || data.replayed !== false || responseIds.has(data.responseId)) fail();
      responseId = data.responseId; responseIds.add(responseId); pendingSubmit = null; latestRuntime=null;
    } else if (kind === 'survey-report') {
      const report=data?.report, summary=report?.sampleSummary;
      if (status !== 200 || data?.id !== id || data.version !== decision.beforeVersion + 1 || data.answerRevision !== decision.beforeAnswerRevision
        || data.reportBasisVersion !== decision.beforeVersion || data.reportBasisAnswerRevision !== decision.beforeAnswerRevision
        || !Array.isArray(data.responses) || data.responses.length !== 8 || new Set(data.responses.map(row=>row.id)).size !== 8 || data.responses.some(row=>!responseIds.has(row.id))
        || !report || !Array.isArray(report.issues) || report.issues.length || !Array.isArray(report.sections) || !report.sections.length
        || !report.sections.some(section=>Array.isArray(section.blocks) && section.blocks.length)
        || summary?.total !== 8 || summary.included !== 8 || summary.excluded !== 0 || summary.pendingReview !== 0
        || report.sections.some(section=>!Array.isArray(section.blocks) || section.blocks.some(block=>!Array.isArray(block.issues) || block.issues.length
          || !Array.isArray(block.rows) || block.rows.some(row=>!Number.isInteger(row.count) || row.count < 8)
          || block.answerTexts !== undefined && (!Array.isArray(block.answerTexts) || block.answerTexts.length < 8)))) fail();
      version=data.version; latestRuntime=null;
    }
  }
  return { arm(entityId) { if (active || !ENTITY.test(entityId ?? '')) fail(); active = true; groupEntity=entityId; }, decide, observe, receipt: () => ({id,responseId}),
    publication: () => token ? {surveyId:id,version:publicationVersion,questionsSha256:publicationQuestionsHash} : null,
    publicLink: () => token ? '/surveys/' + token : null };
}

function confirmations(value, path = '', out = new Set(), depth = 0) {
  if (depth > 20) throw new ProbeFailure('BODY_NESTING_BOUND');
  if (typeof value === 'string' && /^[\[{]/.test(value.trim()) && value.length <= MAX_BODY) {
    try { confirmations(JSON.parse(value), path, out, depth + 1); } catch (error) { if (error instanceof ProbeFailure) throw error; }
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const next = `${path}/${key}`;
      const active = !['', 'false', '[]', '{}'].includes(entry) && entry !== false && entry !== undefined && entry !== null && (!Array.isArray(entry) || entry.length > 0) && (!object(entry) || Object.keys(entry).length > 0);
      if ((/roundCompletion|confirmation|confirmed/i.test(key)) && active) out.add(`${next}:${JSON.stringify(entry)}`);
      confirmations(entry, next, out, depth + 1);
    }
  }
  return out;
}
function checkReferences(value, projectId, threads, resources, depth = 0, orgId) {
  if (depth > 20) throw new ProbeFailure('BODY_NESTING_BOUND');
  if (typeof value === 'string' && /^[\[{]/.test(value.trim()) && value.length <= MAX_BODY) {
    try { checkReferences(JSON.parse(value), projectId, threads, resources, depth + 1, orgId); } catch (error) { if (error instanceof ProbeFailure) throw error; }
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'orgId' && orgId && entry && entry !== orgId) throw new ProbeFailure('FOREIGN_ORGANIZATION_REFERENCE');
      if (['projectId', 'sourceProjectId', 'teachingProjectId'].includes(key) && entry !== null && entry !== '' && entry !== projectId) throw new ProbeFailure('FOREIGN_PROJECT_REFERENCE');
      if (key === 'threadId' && entry !== null && entry !== '' && !threads.has(entry)) throw new ProbeFailure('FOREIGN_THREAD_REFERENCE');
      if (/^(artifactId|versionId|prototypeVersionId|prototypeDesignId|designId|designProjectId|surveyId|resourceId|fileId|interviewId|documentId|revisionId|attachmentId|producedByRunId)$/.test(key) && entry && !resources.has(entry)) throw new ProbeFailure('FOREIGN_RESOURCE_REFERENCE');
      if (key === 'runId' && value.artifactId && entry && !resources.has(entry)) throw new ProbeFailure('FOREIGN_RESOURCE_REFERENCE');
      checkReferences(entry, projectId, threads, resources, depth + 1, orgId);
    }
  }
}

// This separate profile derives limits from named operations; the baseline's
// 44 turns, 263 writes and 16 PDFs remain exclusively in its unchanged modules.

export function createV2AcceptanceGuard(identity, options, legacyNow) {
  if (!options?.plan || !isNamedAcceptanceProfile(options.plan.profile)) throw new ProbeFailure('V2_PLAN_REQUIRED');
  const now = options.now ?? legacyNow ?? Date.now;
  const plan = options.plan;
  const case01 = plan.profile === CASE01_PROFILE;
  if (case01) assertCase01Plan(plan);
  const stageFiles = case01 ? createCase01StageFiles(identity) : null;
  const { manifestSha256, ...planBody } = plan;
  if (!Array.isArray(plan.operations) || !plan.operations.length || plan.operations.length > 2048 || contentHash(planBody) !== manifestSha256
    || new Set(plan.operations.map(row => row.id)).size !== plan.operations.length
    || plan.limits.physicalMutationRequests !== plan.operations.filter(row => !['ui','read'].includes(row.kind)).length) throw new ProbeFailure('V2_PLAN_CHANGED');
  const TEACHING_TURN_LIMIT = Math.min(case01 ? CASE01_LIMITS.teaching : Infinity, plan.operations.filter(row => ['teaching','asr'].includes(row.kind)).length);
  const WRITE_LIMIT = plan.limits.physicalMutationRequests + 2;
  const operationMap = new Map(plan.operations.map(row => [row.id, row]));
  const tickets = new Map(), requestTickets = new WeakMap();
  const readOption = key => typeof options[key] === 'function' ? options[key]() : options[key];
  let decidingTicket = null, interfaceGuard;
  // Case01 counts every admitted business HTTP mutation, including teaching and public Survey responses.
  // The single normal login remains separately counted by loginRequests, as in the source plan.
  let case01PhysicalWrites = 0;
  const case01BusinessWrite = request => case01 && ["POST","PUT","PATCH","DELETE"].includes(request.method) && new URL(request.url).pathname !== "/api/auth/login";

  let actor = null, org = null, candidate = null, projectId = null, loginArmed = false, fatal = null;
  let loginCount = 0, createCount = 0, arm = null, allowedWrites = 0, ordinaryVerified = false, projectCreateUntil = null, projectCourseTag;
  const threadCoordinates = new Map(), threadFacts = new Map(), threadPins = new Map(), messageSnapshots = new Map(), stageStates = new Map(), skillCatalog = new Map(), teachingLedger = new Map(), ownedRuns = new Set();
  let reconcileCount = 0;
  let teachingRequests = 0, suggestionsBlocked = 0, teachingStopped = false, isolatedProblemReceipt = null;
  const threads = new Set(), resources = new Set(), uploads = new Map(), fixtures = new Map(), snapshots = new Map(), teachingSkills = new Set();
  const ownedDesigns = new Set(), linkedDesigns = new Set(), nativeAudio = new Map(), researchSources = new Map();
  const entityRoles = new Map(), threadRoles = new Map(), publishedArtifacts = new Map();
  const stageVersions = new Map(), verifiedUploadContents = new Map(), designSourceFacts = new Map(), designSourceReceipts = new Map(), designNativeStates = new Map();
  const observedAsrRuns = new Map(), reviewedAsrNonces = new Set(), decidedAsrPermissions = new Set();
  let staticPersonas;
  function knownStaticPersonas() {
    if (staticPersonas) return staticPersonas;
    const path = 'apps/web/lib/interview-personas/experts-persona.json', fail = () => {throw new ProbeFailure('V2_RESEARCH_PERSONA_CATALOG_UNVERIFIED');};
    const root = new URL('../../../../',import.meta.url), file = new URL(path,root);
    try {
      const source = JSON.parse(readFileSync(new URL('acceptance-source.json',root),'utf8')), metadata = source.personaCatalogue;
      const stat = lstatSync(file);
      if (source.profile !== V2_VOICE_PROFILE || source.controlSource !== identity.controlSource || !exactKeys(metadata,['path','sha256','bytes'])
        || metadata.path !== path || !/^[a-f0-9]{64}$/.test(metadata.sha256 ?? '') || !stat.isFile() || stat.isSymbolicLink()
        || stat.size < 1 || stat.size > MAX_BODY || stat.size !== metadata.bytes) fail();
      const lines = readFileSync(new URL('SHA256SUMS',root),'utf8').split('\n').filter(line=>line.endsWith('  ' + path));
      const bytes = readFileSync(file);
      if (lines.length !== 1 || lines[0] !== metadata.sha256 + '  ' + path || createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) fail();
      const data = JSON.parse(bytes.toString('utf8')), categories = data?.experts_database?.categories;
      if (!object(categories) || Object.values(categories).some(category=>!Array.isArray(category?.experts))) fail();
      const rows = Object.values(categories).flatMap(category=>category.experts);
      if (!rows.length || rows.length > 256 || rows.some(row=>!ENTITY.test(row?.id ?? '') || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200)
        || new Set(rows.map(row=>row.id)).size !== rows.length) fail();
      staticPersonas = new Map(rows.map(row=>['persona-' + row.id,row.name]));
      return staticPersonas;
    } catch {return fail();}
  }
  function selectedPersona(markdown) {
    const links = [...markdown.matchAll(/\[([^\]\n]+)\]\(#expert-([A-Za-z0-9_-]+)\)/gu)];
    if (links.length !== 1 || !markdown.includes('画像类型：模拟画像；不是组织已发布专家或真人访谈证据。')) throw new ProbeFailure('V2_RESEARCH_SINGLE_PERSONA_REQUIRED');
    const name = links[0][1].replace(/\\([\\[\]()*_`#<>])/gu,'$1'), id = links[0][2];
    if (knownStaticPersonas().get(id) !== name) throw new ProbeFailure('V2_RESEARCH_SINGLE_PERSONA_REQUIRED');
    return id;
  }
  let imageArm = null;
  let uploadArm = null, designArm = null, designId = null, modelArm = null, modelCount = 0, modelReceipt = null, modelRequestedScreens = null;
  const survey = createV2SurveyGuard(() => decidingTicket,now);
  const readCategories = { nativeAgentCatalog: 0, runtimeMetadata: 0, other: 0 };
  const readDenials = { nativeAgentCatalog: 0, runtimeMetadata: 0, other: 0 };
  const metadataHttpStatuses = [];
  let metadataHttpStatusesTruncated = false;
  const stop = code => {
    fatal ??= code;
    for (const ticket of tickets.values()) if (ticket.state === 'SENT') {
      ticket.state = 'UNKNOWN';
      try { ticket.ledger.settleOperation(ticket.operationId, { scope: ticket.scope, outcome: 'unknown' }); } catch { /* Preserve the original fail-closed result. */ }
    }
    return { allow: false, kind: 'rejected', code: fatal };
  };
  function runtime() {
    const value = readOption('runtimeScope');
    if (!projectId || !ordinaryVerified || !value || !SHA.test(identity.controlSource ?? '')
      || value.source !== identity.source || value.controlSource !== identity.controlSource || value.tag !== identity.tag
      || value.run !== identity.run || value.attempt !== identity.attempt || value.orgId !== org || value.actorId !== actor
      || value.orgRole !== 'consultant' || value.projectId !== projectId) throw new ProbeFailure('V2_RUNTIME_SCOPE_UNVERIFIED');
    assertV2RuntimeIdentity(value, value);
    return value;
  }
  function storedObject(raw) { try { return typeof raw === 'string' && raw.length <= 6000 ? JSON.parse(raw) : null; } catch { return null; } }
  function prototypeFields(stage, design) {
    const fields = stage?.content?.draft?.fields, value = storedObject(fields?.['prototypeEntity:' + design]);
    if (!object(value) || Object.values(value).some(field => typeof field !== 'string')) return null;
    for (const name of ['prototypeTextDesign','prototypeTextVersion','prototypeTextLineage','prototypeTextConfirmation','prototypeTextConfirmedText','prototypeTextConfirmedLineage','prototypeSourceImages']) {
      if (fields[`prototypeText:${design}:${name}`] !== undefined) value[name] = fields[`prototypeText:${design}:${name}`];
    }
    return value;
  }
  function rememberStageVersion(stage) {
    if (stage?.projectId !== projectId || !Number.isInteger(stage.stageId) || stage.stageId < 1 || stage.stageId > 6
      || !Number.isSafeInteger(stage.revision) || stage.revision < 1 || !object(stage.content?.draft?.fields)) throw new ProbeFailure('STAGE_RESPONSE_REJECTED');
    const key = stage.stageId + ':' + stage.revision, prior = stageVersions.get(key);
    if (prior && contentHash(prior) !== contentHash(stage)) throw new ProbeFailure('V2_STAGE_VERSION_CHANGED');
    stageVersions.set(key,structuredClone(stage));
  }
  function sourceImageFacts(coordinates) {
    const fail = () => {throw new ProbeFailure('V2_DESIGN_SOURCE_UNVERIFIED');};
    if (!exactKeys(coordinates,['designId','stage4Revision','brainstormId','ideaIds']) || !ownedDesigns.has(coordinates.designId)
      || !linkedDesigns.has(coordinates.designId) || !Number.isSafeInteger(coordinates.stage4Revision) || coordinates.stage4Revision < 1
      || !ENTITY.test(coordinates.brainstormId ?? '') || !Array.isArray(coordinates.ideaIds) || ![1,3].includes(coordinates.ideaIds.length)
      || new Set(coordinates.ideaIds).size !== coordinates.ideaIds.length || coordinates.ideaIds.some(id=>!ENTITY.test(id))) fail();
    const role = entityRoles.get('5:' + coordinates.designId), expectedCount = role === 'prototype-single' ? 1 : role === 'prototype-three' ? 3 : null;
    if (coordinates.ideaIds.length !== expectedCount) fail();
    const current = prototypeFields(stageStates.get(5),coordinates.designId), selection = storedObject(current?.prototypeIdeaSource), confirmation = storedObject(current?.prototypeTextConfirmation);
    if (!current || current.prototypeArchived === 'true' || !exactKeys(selection,['revision','brainstormId','ideaIds'])
      || selection.revision !== coordinates.stage4Revision || selection.brainstormId !== coordinates.brainstormId || contentHash(selection.ideaIds) !== contentHash(coordinates.ideaIds)
      || !object(confirmation) || confirmation.projectId !== projectId || confirmation.designId !== coordinates.designId || !Number.isSafeInteger(confirmation.stageRevision)
      || confirmation.stageRevision < 1 || confirmation.stageRevision > stageStates.get(5).revision
      || confirmation.selection !== current.prototypeIdeaSource || confirmation.textVersion !== current.prototypeTextVersion
      || !current.prototypeTextDesign?.trim() || current.prototypeTextDesign.length > 3000 || current.prototypeTextConfirmedText !== current.prototypeTextDesign
      || current.prototypeTextConfirmedLineage !== current.prototypeTextLineage) fail();
    const savedText = prototypeFields(stageVersions.get('5:' + confirmation.stageRevision),coordinates.designId);
    if (!savedText || savedText.prototypeTextDesign !== current.prototypeTextDesign || savedText.prototypeTextVersion !== current.prototypeTextVersion
      || savedText.prototypeIdeaSource !== current.prototypeIdeaSource || savedText.prototypeTextLineage !== current.prototypeTextLineage) fail();
    const lineage = storedObject(current.prototypeTextLineage), sourceStage = stageVersions.get('4:' + coordinates.stage4Revision);
    const round = storedObject(sourceStage?.content.draft.fields['ideaBrainstormRoundCompletion:' + coordinates.brainstormId]);
    if (!object(lineage) || lineage.projectId !== projectId || lineage.stage4Revision !== coordinates.stage4Revision || lineage.brainstormId !== coordinates.brainstormId
      || !Array.isArray(lineage.ideas) || contentHash(lineage.ideas.map(idea=>idea?.ideaId)) !== contentHash(coordinates.ideaIds)
      || !object(round) || round.schemaVersion !== 1 || round.status !== 'confirmed' || round.projectId !== projectId || round.sessionId !== coordinates.brainstormId
      || !Array.isArray(round.sheets) || round.sheets.length < 3 || round.sheets.length > 8 || new Set(round.sheets.map(sheet=>sheet?.id)).size !== round.sheets.length
      || !Array.isArray(round.selectedIds) || !round.selectedIds.length || new Set(round.selectedIds).size !== round.selectedIds.length
      || round.selectedIds.some(id=>!round.sheets.some(sheet=>sheet.id === id))
      || round.classification?.confirmed !== true) fail();
    const images = coordinates.ideaIds.map(ideaId => {
      const sheet = round.sheets.find(item=>item.id === ideaId), material = storedObject(sheet?.imageMaterial);
      const read = material && verifiedUploadContents.get(material.runId);
      if (!sheet?.title?.trim() || !sheet.description?.trim() || !object(material) || material.projectId !== projectId
        || !['image/png','image/jpeg','image/webp'].includes(material.mime) || !Number.isSafeInteger(material.bytes) || material.bytes < 1 || material.bytes > 4194304
        || !read || read.artifactId !== material.artifactId || read.versionId !== material.versionId || read.sha256 !== material.sha256
        || read.sizeBytes !== material.bytes || read.mime !== material.mime || now() - read.at > 180000 || read.at > now()) fail();
      return {sourceRunId:material.runId,artifactId:material.artifactId,versionId:material.versionId,sha256:material.sha256,bytes:material.bytes,mime:material.mime,
        stage4Revision:coordinates.stage4Revision,brainstormId:coordinates.brainstormId,ideaId,
        nativeName:`aidt-source-${material.sha256}.${material.mime === 'image/png' ? 'png' : material.mime === 'image/jpeg' ? 'jpg' : 'webp'}`};
    });
    const unique = [...new Map(images.map(image=>[image.sha256,image])).values()];
    if (!unique.length || unique.length > 3) fail();
    return {coordinates:structuredClone(coordinates),role,images:unique,textBasis:{schemaVersion:1,projectId,designId:coordinates.designId,
      textStageRevision:confirmation.stageRevision,textVersion:confirmation.textVersion,textSha256:createHash('sha256').update(current.prototypeTextDesign).digest('hex')}};
  }
  function currentDesignSource(design) {
    const known = designSourceFacts.get(design);
    if (!known) throw new ProbeFailure('V2_DESIGN_SOURCE_UNVERIFIED');
    const current = sourceImageFacts(known.coordinates);
    if (contentHash(current) !== contentHash(known)) throw new ProbeFailure('V2_DESIGN_SOURCE_CHANGED');
    return current;
  }
  function checkedAsrPermission(ticket) {
    if (ticket.requestKind !== 'asr-permission-once' || !exactKeys(ticket.expectedFields,['decision','asrPermission'])
      || ticket.expectedFields.decision !== 'once') throw new ProbeFailure('V2_ASR_PERMISSION_UNVERIFIED');
    const permission = ticket.expectedFields.asrPermission;
    const entries = [...teachingLedger.values()].filter(entry => entry.accepted?.runId === permission?.runId);
    if (entries.length !== 1) throw new ProbeFailure('V2_ASR_PERMISSION_UNVERIFIED');
    const proof = assertV2AsrOnceEvidence({stageId:ticket.stageId,entityRole:ticket.entityRole,entityId:ticket.entityId,projectId,actorId:actor,
      permission,entry:entries[0],observed:observedAsrRuns.get(permission.runId),review:permission.review,now:now()});
    if (proof.operationId !== ticket.operationId || reviewedAsrNonces.has(proof.nonce)
      || decidedAsrPermissions.has(proof.runId + ':' + proof.permissionRequestId)) throw new ProbeFailure('V2_ASR_PERMISSION_REPLAYED');
    return proof;
  }
  function armV2Operation(input) {
    const { manifestSha256: currentManifest, ...currentPlan } = plan;
    if (currentManifest !== manifestSha256 || contentHash(currentPlan) !== manifestSha256) throw new ProbeFailure('V2_PLAN_CHANGED');
    if (!object(input) || Object.keys(input).some(key => !['operationId','kind','requestKind','stageId','entityRole','entityId','resourceId','expectedFields'].includes(key))) throw new ProbeFailure('V2_REQUEST_SLOT_INVALID');
    const row = operationMap.get(input.operationId), scope = runtime(), ledger = readOption('ledger');
    const expectedKind = REQUEST_KINDS.get(input.requestKind);
    const surveyStageWrite = input.requestKind === 'stage-save' && input.kind === 'survey' && input.entityRole === 'test-survey';
    if (!row || !ledger || expectedKind !== input.kind && !surveyStageWrite || row.kind !== input.kind
      || row.stage !== input.stageId || row.entityRole !== input.entityRole || tickets.has(input.operationId)
      || !Number.isInteger(input.stageId) || input.stageId < 1 || input.stageId > 6
      || input.entityId !== undefined && !ENTITY.test(input.entityId)
      || input.resourceId !== undefined && (!/^[A-Za-z0-9_.:-]{1,256}$/.test(input.resourceId) || !resources.has(input.resourceId))
      || input.expectedFields !== undefined && (!object(input.expectedFields) || Buffer.byteLength(JSON.stringify(input.expectedFields)) > MAX_BODY)) throw new ProbeFailure('V2_REQUEST_SLOT_INVALID');
    if (input.requestKind === 'asr-permission-once') checkedAsrPermission(input);
    ledger.claimOperation(input.operationId, scope);
    tickets.set(input.operationId, { ...structuredClone(input), until: now() + 15000, state: 'ARMED', ledger, scope });
  }
  function requestKind(request) {
    let path; try { path = new URL(request.url).pathname; } catch { return null; }
    const method = request.method;
    if (method === 'POST' && path === '/api/copilotkit/agent/default/run') return ['teaching-send','asr-file'];
    if (method === 'POST' && /^\/api\/agent-runs\/[^/]+\/permission-requests\/[^/]+\/decision$/.test(path)) return 'asr-permission-once';
    if (method === 'POST' && path === '/api/pm-designs') return 'design-create';
    if (method === 'POST' && /^\/api\/pm-designs\/[^/]+\/chat$/.test(path)) return 'design-generate';
    if (method === 'POST' && /^\/api\/pm-designs\/[^/]+\/prototype\/patch$/.test(path)) return 'design-image';
    if (method === 'POST' && /^\/api\/pm-designs\/[^/]+\/ref-images$/.test(path)) return 'design-ref-image';
    if (method === 'POST' && path === `/api/projects/${projectId}/resources`) return request.body?.kind === 'design' ? 'design-link' : request.body?.kind === 'survey' ? 'survey-link' : null;
    if (method === 'POST' && path === `/api/projects/${projectId}/artifacts/upload`) return 'upload';
    if (method === 'POST' && /^\/api\/chat\/threads\/[^/]+\/attachments$/.test(path)) return case01 ? ['chat-audio-upload','chat-stage-text-upload'] : 'chat-audio-upload';
    if (method === 'PUT' && new RegExp(`^/api/projects/${projectId}/aidt/stages/[1-6]$`).test(path)) return 'stage-save';
    if (method === 'PUT' && new RegExp(`^/api/projects/${projectId}/aidt/stages/[1-6]/entities/[^/]+/thread$`).test(path)) return 'entity-thread';
    if (method === 'POST' && new RegExp(`^/api/projects/${projectId}/aidt/stages/[12]/entities/[^/]+/reconcile$`).test(path)) return 'reconcile-entity';
    if (method === 'POST' && path === '/api/chat/threads/mutate') return 'thread-create';
    if (method === 'POST' && /^\/api\/threads\/[^/]+\/skill-mounts$/.test(path)) return 'thread-mount';
    if (method === 'POST' && path === '/api/surveys') return 'survey-create';
    if (method === 'POST' && path === '/api/surveys/markdown-proposals') return 'survey-proposal';
    if (method === 'PUT' && /^\/api\/surveys\/[^/]+\/source$/.test(path)) return 'survey-source';
    if (method === 'POST' && /^\/api\/surveys\/[^/]+\/publish$/.test(path)) return 'survey-publish';
    if (method === 'POST' && /^\/api\/surveys\/[^/]+\/close$/.test(path)) return 'survey-close';
    if (method === 'POST' && /^\/api\/surveys\/[^/]+\/report$/.test(path)) return 'survey-report';
    if (method === 'POST' && /^\/api\/public\/surveys\/[^/]+\/responses$/.test(path)) return 'survey-submit';
    if (method === 'POST' && path === '/api/interviews/digital') return 'research-create';
    const research = /^\/api\/interviews\/digital\/[^/]+\/markdown(?:\/(initialize|execution|intake|analysis|experts|outline|report|runs)(?:\/(confirm|generate|generate-stream))?)?$/.exec(path);
    if (method === 'POST' && research) return research[1] === 'initialize' ? 'research-initialize' : research[1] === 'execution' ? 'research-execute'
      : research[2] === 'confirm' ? 'research-confirm' : ['generate','generate-stream'].includes(research[2]) ? 'research-generate' : 'research-save';
    return null;
  }
  function claimRequest(request) {
    const kind = requestKind(request);
    const matches = [...tickets.values()].filter(ticket => ticket.state === 'ARMED' && ticket.until >= now() && (Array.isArray(kind) ? kind.includes(ticket.requestKind) : ticket.requestKind === kind));
    if (matches.length !== 1) throw new ProbeFailure('V2_EXACT_REQUEST_SLOT_REQUIRED');
    const ticket = matches[0], target = new URL(request.url), body = request.body;
    const stage = /\/aidt\/stages\/([1-6])(?:\/entities\/([^/]+)\/thread)?$/.exec(target.pathname);
    if (stage && (Number(stage[1]) !== ticket.stageId || stage[2] && ticket.entityId !== stage[2])) throw new ProbeFailure('V2_REQUEST_ENTITY_MISMATCH');
    if (ticket.resourceId && !target.pathname.split('/').includes(ticket.resourceId) && body?.resourceId !== ticket.resourceId
      && !(ticket.requestKind === 'survey-submit' && ticket.resourceId === survey.receipt().id)) throw new ProbeFailure('V2_REQUEST_RESOURCE_MISMATCH');
    if (ticket.expectedFields && !Object.entries(ticket.expectedFields).filter(([key]) => !['nativeActionPrefix','selector','skillId','skillVersionId','knownMessages','audioFixture','confirmation'].includes(key)
      && !(key === 'asrPermission' && ticket.requestKind === 'asr-permission-once')
      && !(key === 'surveyPublication' && ticket.requestKind === 'survey-submit')
      && !(key === 'sourceImage' && ticket.requestKind === 'design-ref-image')
      && !(key === 'threadId' && ['teaching-send','asr-file'].includes(ticket.requestKind)))
      .every(([key, value]) => contentHash(body?.[key]) === contentHash(value))) throw new ProbeFailure('V2_REQUEST_EXPECTATION_MISMATCH');
    runtime();
    ticket.requestSha256 = contentHash({ method: request.method, path: target.pathname, query: [...target.searchParams], body });
    return ticket;
  }
  function decideRequest({ url, method, resourceType, body }) {
    if (fatal) return { allow: false, kind: 'stopped', code: fatal };
    if (/%2f|%5c|%2e|\\/i.test(url.split('?')[0])) return stop('TARGET_REJECTED');
    let target;
    try { target = new URL(url); } catch { return stop('TARGET_REJECTED'); }
    if (target.origin !== ORIGIN || target.username || target.password || target.hash || /%2f|%5c|%2e|\\/i.test(target.pathname)) return stop('TARGET_REJECTED');
    if (new Set(target.searchParams.keys()).size !== [...target.searchParams.keys()].length) return stop('DUPLICATE_QUERY_REJECTED');
    const path = target.pathname;
    if (body !== undefined && Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY) return stop('REQUEST_BODY_BOUND');
    if (projectId && target.searchParams.has('projectId') && target.searchParams.get('projectId') !== projectId) return stop('FOREIGN_PROJECT_REFERENCE');
    const audioThread = /^\/api\/chat\/threads\/([^/]+)\/attachments$/.exec(path);
    if (case01 && method === 'POST' && audioThread && decidingTicket?.requestKind === 'chat-stage-text-upload') {
      if (!ordinaryVerified || !threads.has(audioThread[1]) || !threadFacts.get(audioThread[1])?.writable) return stop('CASE01_STAGE_FILE_NOT_BOUND');
      const decision = stageFiles.upload(target, body, decidingTicket); allowedWrites++; return decision;
    }
    if (method === 'POST' && audioThread) {
      const file = body?.files?.[0], expected = decidingTicket?.expectedFields?.audioFixture, fixture = expected && fixtures.get(expected.filename);
      if (target.search || decidingTicket?.requestKind !== 'chat-audio-upload' || !threads.has(audioThread[1]) || !threadFacts.get(audioThread[1])?.writable
        || !fixture || !exactKeys(expected, ['filename','sizeBytes','sha256','mime']) || contentHash(expected) !== contentHash(fixture)
        || !exactKeys(body,['__multipart','files','fields']) || body.__multipart !== true || body.files.length !== 1 || !file || contentHash(file) !== contentHash(fixture)
        || !exactKeys(body.fields,[])
        || !['audio/wav','audio/x-wav','audio/mpeg'].includes(file.mime)) return stop('V2_AUDIO_ATTACHMENT_NOT_ARMED');
      allowedWrites++; return { allow: true, kind: 'v2-audio-upload', threadId: audioThread[1], fixture };
    }
    if (allowedWrites - reconcileCount >= WRITE_LIMIT && method !== 'GET') return stop('WRITE_COUNT_BOUND');
    const surveyDecision = survey.decide(method, target, body, projectId);
    if (surveyDecision) {
      if (method !== 'GET') allowedWrites++;
      return surveyDecision;
    }
    if (method === 'POST' && path === '/api/auth/login' && !target.search) {
      if (!loginArmed || actor || loginCount !== 0 || !object(body) || Object.keys(body).sort().join(',') !== 'email,password' || !body.email || !body.password) return stop('LOGIN_REJECTED');
      loginCount++; return { allow: true, kind: 'login' };
    }
    if (!actor && method !== 'GET') return stop('AUTHENTICATION_REQUIRED');
    if (identity.entryDiagnosticOnly && method !== 'GET') return stop('ENTRY_DIAGNOSTIC_READONLY');
    if (method === 'POST' && (path === '/api/copilotkit/agent/default/suggest' || path === '/api/copilotkit/agent/default/run' && body?.forwardedProps?.toolChoice?.function?.name === 'copilotkitSuggest')) { suggestionsBlocked++; return { allow: false, kind: 'optional-suggestion-blocked', code: 'OPTIONAL_SUGGESTION_NOT_EXERCISED' }; }
    if (method === 'GET') {
      if (ordinaryVerified && projectId && path === '/api/canvas/templates' && target.searchParams.get('orgId') === org
        && target.searchParams.get('filter') === 'published' && [...target.searchParams.keys()].sort().join(',') === 'filter,orgId') return { allow: true, kind: 'v2-template-catalog' };
      if (ordinaryVerified && projectId && ['/api/interviews/digital/expert-library','/api/interviews/digital/experts'].includes(path)
        && !target.search) return { allow: true, kind: 'v2-research-library' };
      const nativeArtifacts = /^\/api\/agent-artifacts\/threads\/([^/]+)$/.exec(path);
      if (nativeArtifacts && threads.has(nativeArtifacts[1]) && target.searchParams.get('projectId') === projectId && target.searchParams.size === 1)
        return { allow: true, kind: 'v2-native-artifacts', threadId: nativeArtifacts[1] };
      const nativeContent = /^\/api\/artifacts\/([^/]+)\/versions\/([1-9][0-9]*)\/content$/.exec(path);
      if (nativeContent && !target.search && publishedArtifacts.has(nativeContent[1] + ':' + nativeContent[2])) return { allow: true, kind: 'v2-native-artifact-content', artifactKey: nativeContent[1] + ':' + nativeContent[2] };
      const stageFileRead = stageFiles?.read(target); if (stageFileRead) return stageFileRead;
      const audioContent = /^\/api\/chat\/threads\/([^/]+)\/attachments\/([^/]+)\/content$/.exec(path);
      if (audioContent && !target.search && nativeAudio.get(audioContent[2])?.threadId === audioContent[1]) return { allow: true, kind: 'v2-native-audio-content', attachmentId: audioContent[2] };
      const researchRead = /^\/api\/interviews\/digital\/([^/]+)(\/markdown)?$/.exec(path);
      if (researchRead && !target.search && researchSources.has(researchRead[1])) return { allow: true, kind: researchRead[2] ? 'v2-research-envelope' : 'v2-research-view', researchId: researchRead[1] };
      const researchPage = /^\/itv\/([^/]+)\/(intake|analysis|experts|outline|runs|report)$/.exec(path);
      if (researchPage && researchSources.has(researchPage[1]) && (!target.searchParams.has('projectId') || target.searchParams.get('projectId') === projectId)
        && [...target.searchParams.keys()].every(key => ['projectId','documentId','version','_rsc'].includes(key))) {
        const source = researchSources.get(researchPage[1]), docId = target.searchParams.get('documentId'), version = target.searchParams.get('version');
        if (docId !== null || version !== null) {
          if (!docId || !/^[1-9][0-9]*$/.test(version ?? '') || !source.documents?.has(docId + ':' + version)) return stop('V2_RESEARCH_VERSION_UNOBSERVED');
        }
        return { allow: true, kind: 'read' };
      }
      // Native AgentOptions reads only this organization's agent catalog. This
      // does not authorize capability mutations or requests before QA ownership.
      if (path === '/api/capabilities' && ordinaryVerified && projectId
        && [...target.searchParams.keys()].sort().join(',') === 'kind,orgId'
        && target.searchParams.get('orgId') === org && target.searchParams.get('kind') === 'agent') {
        return { allow: true, kind: 'native-agent-catalog' };
      }
      // Match the baseline's exact QA catalog channel. The shared interceptor
      // exposes only an actually verified run-owned row, never foreign rosters.
      if (actor && path === '/api/projects' && target.searchParams.get('orgId') === org
        && [...target.searchParams.keys()].join(',') === 'orgId') {
        return { allow: true, kind: 'qa-project-catalog', projectId };
      }
      const publicPage = path === '/login' || path === '/aidt' || path === '/favicon.ico' || path.startsWith('/_next/static/') || approvedHomeImage(target);
      const accountRead = actor && (path === '/api/identity/me' || path === '/api/aidt/courses' || (path === '/api/copilotkit/info' && !target.search) || (path === '/api/skills' && target.searchParams.get('orgId') === org && [...target.searchParams.keys()].every(key => ['orgId', 'entry'].includes(key))));
      const ownedRead = (projectId || candidate) && (path === `/aidt/${projectId ?? candidate}` || path.startsWith(`/api/projects/${projectId ?? candidate}/`));
      const exactStage = new RegExp(`^/api/projects/${projectId}/aidt/stages/([1-6])/revision/([1-9][0-9]*)$`).exec(path);
      if (ordinaryVerified && projectId && exactStage && !target.search && Number(exactStage[2]) <= 2147483647)
        return {allow:true,kind:'v2-stage-version',stageId:Number(exactStage[1]),revision:Number(exactStage[2])};
      const stageHistory = new RegExp(`^/api/projects/${projectId}/aidt/stages/([1-6])/revisions$`).exec(path);
      if (ordinaryVerified && projectId && stageHistory && [...target.searchParams.keys()].every(key=>['beforeRevision','limit'].includes(key))
        && /^[1-9][0-9]*$/.test(target.searchParams.get('beforeRevision') ?? '') && Number(target.searchParams.get('beforeRevision')) <= 2147483647
        && target.searchParams.get('limit') === '1') return {allow:true,kind:'v2-stage-history',stageId:Number(stageHistory[1]),beforeRevision:Number(target.searchParams.get('beforeRevision'))};
      for (const id of threads) {
        if (path === `/api/chat/threads/${encodeURIComponent(id)}`) return { allow: true, kind: 'thread-detail', threadId: id };
        if (path === `/api/chat/threads/${encodeURIComponent(id)}/messages`) return { allow: true, kind: 'thread-messages', threadId: id };
        if (path === `/api/threads/${encodeURIComponent(id)}/skill-deviations`) return { allow: true, kind: 'thread-pins', threadId: id };
      }
      const executionRead = decideOwnedTeachingExecutionRead(target, method, { actorId: actor, orgId: org, projectId, threads, ownedRuns, teachingLedger });
      if (executionRead) return executionRead;
      const runRead = /^\/api\/agent-runs\/([A-Za-z0-9_.:-]+)(?:\/aidt-context)?$/.exec(path);
      if (runRead && !target.search) return ownedRuns.has(runRead[1]) ? { allow: true, kind: 'owned-teaching-run-read', runId: runRead[1] } : { allow: false, kind: 'teaching-run-needs-binding', runId: runRead[1] };
      const ownedChat = [...threads].some(id => path === `/api/chat/threads/${encodeURIComponent(id)}` || path.startsWith(`/api/chat/threads/${encodeURIComponent(id)}/`)
        || path === `/api/threads/${encodeURIComponent(id)}/skill-mounts` || path === `/api/threads/${encodeURIComponent(id)}/skill-deviations`);
      const projectChatList = projectId && path === '/api/chat/threads' && target.searchParams.get('projectId') === projectId;
      // Only metadata for a freshly generated, deliberately nonexistent ID is read for the denial check.
      const deniedProbe = identity.deniedProject && path === `/api/projects/${identity.deniedProject}/overview`;
      if (deniedProbe) return { allow: true, kind: 'denied-probe' };
      if (projectId && path === '/api/pm-designs' && !target.search) return { allow: true, kind: 'design-list' };
      const versions = /^\/api\/pm-designs\/([A-Za-z0-9_-]{1,128})\/versions(?:\/([^/]+))?$/.exec(path);
      if (versions && ownedDesigns.has(versions[1]) && (!versions[2] || resources.has(versions[2])) && !target.search) return { allow: true, kind: 'design-versions', designId: versions[1] };
      const uploadRead = /^\/api\/ingestion-runs\/([^/]+)(\/content)?$/.exec(path);
      if (uploadRead && uploads.has(uploadRead[1]) && target.searchParams.get('projectId') === projectId && [...target.searchParams.keys()].every(key => key === 'projectId')) return { allow: true, kind: uploadRead[2] ? 'upload-content' : 'read', runId: uploadRead[1] };
      if (publicPage || accountRead || ownedRead || ownedChat || projectChatList || deniedProbe) {
        const stage = new RegExp(`^/api/projects/${projectId ?? candidate}/aidt/stages/([1-6])$`).exec(path);
        return stage ? { allow: true, kind: 'get-stage', stageId: Number(stage[1]) } : { allow: true, kind: path === '/api/skills' ? 'skill-catalog' : 'read' };
      }
      // Optional shell requests must not expand the test into unrelated user resources.
      return { allow: false, kind: 'out-of-scope-read', code: resourceType === 'document' ? 'NAVIGATION_REJECTED' : 'READ_OUT_OF_SCOPE' };
    }
    const asrDecision = /^\/api\/agent-runs\/([^/]+)\/permission-requests\/([^/]+)\/decision$/.exec(path);
    if (asrDecision) {
      if (method !== 'POST' || target.search || decidingTicket?.requestKind !== 'asr-permission-once'
        || !exactKeys(body,['decision']) || body.decision !== 'once') return stop('V2_ASR_PERMISSION_UNVERIFIED');
      let proof; try { proof = checkedAsrPermission(decidingTicket); } catch (error) { return stop(error.code ?? 'V2_ASR_PERMISSION_UNVERIFIED'); }
      if (proof.runId !== asrDecision[1] || proof.permissionRequestId !== asrDecision[2]) return stop('V2_ASR_PERMISSION_UNVERIFIED');
      reviewedAsrNonces.add(proof.nonce); decidedAsrPermissions.add(proof.runId + ':' + proof.permissionRequestId);
      allowedWrites++; return {allow:true,kind:'v2-asr-permission-once',runId:proof.runId,permissionRequestId:proof.permissionRequestId};
    }
    if (method === 'DELETE' || !['POST', 'PUT', 'PATCH'].includes(method) || /\/(?:members|collaborators|roles|permissions|courses|admin|config|policies|archive|restore)(?:\/|$)/.test(path)) return stop('FORBIDDEN_MUTATION');
    if (method === 'POST' && path === '/api/projects' && !projectId && !candidate) {
      if (!ordinaryVerified || !projectCreateUntil || now() > projectCreateUntil || createCount !== 0 || !object(body) || Object.keys(body).sort().join(',') !== (projectCourseTag === undefined ? 'blueprintVersionId,kind,name,orgId,profile' : 'blueprintVersionId,courseTag,kind,name,orgId,profile') || body.courseTag !== projectCourseTag || body.orgId !== org || body.kind !== 'general' || body.blueprintVersionId !== null || body.profile !== 'aidt' || body.name !== identity.projectName) return stop('PROJECT_CREATE_REJECTED');
      projectCreateUntil = null; createCount++; allowedWrites++; return { allow: true, kind: 'create-project' };
    }
    if (!projectId) return stop('OWNED_PROJECT_REQUIRED');
    if (method === 'POST' && path === '/api/interviews/digital' && !target.search) {
      const ticket = decidingTicket;
      let group; try { group = JSON.parse(stageStates.get(6)?.content.draft.fields['testGroup:' + ticket?.entityId]); } catch { /* Not an observed test. */ }
      if (ticket?.requestKind !== 'research-create' || ticket.operationId !== 's6-test-virtual-native-create' || ticket.entityRole !== 'test-virtual'
        || ticket.stageId !== 6 || !ordinaryVerified || group?.id !== ticket.entityId || group.archived
        || group.researchPath !== 'virtual' || group.source || !exactKeys(body, ['name','tags','scope','requestId'])
        || body.name !== (group.name || '原型虚拟用户研究').slice(0,120) || contentHash(body.tags) !== contentHash(['AIDT','模拟'])
        || !exactKeys(body.scope, ['kind','projectId','researchProjectId']) || body.scope.kind !== 'project' || body.scope.projectId !== projectId || body.scope.researchProjectId !== null
        || body.requestId !== `aidt-s6-${projectId}-${group.id}`) return stop('V2_RESEARCH_CREATE_REJECTED');
      allowedWrites++; return { allow: true, kind: 'v2-research-create', entityId: group.id };
    }
    const researchWrite = /^\/api\/interviews\/digital\/([^/]+)\/markdown\/(initialize|execution|intake|analysis|experts|outline|report|runs)(?:\/(confirm|generate|generate-stream))?$/.exec(path);
    if (method === 'POST' && researchWrite) {
      const source = researchSources.get(researchWrite[1]), envelope = source?.envelope, step = researchWrite[2], action = researchWrite[3];
      if (!source || !envelope || target.search || decidingTicket?.entityId !== source.entityId || decidingTicket.stageId !== 6
        || !object(body) || body.expectedVersion !== envelope.version) return stop('V2_RESEARCH_VERSION_UNVERIFIED');
      const ticket = decidingTicket;
      const targets = {
        's6-test-virtual-native-initialize':['initialize',undefined,'research-initialize'],
        's6-test-virtual-native-save-intake':['intake',undefined,'research-save'],
        's6-test-virtual-native-edit-intake':['intake',undefined,'research-save'],
        's6-test-virtual-native-confirm-intake':['intake','confirm','research-confirm'],
        's6-test-virtual-analysis':['analysis','generate','research-generate'],
        's6-test-virtual-native-confirm-analysis':['analysis','confirm','research-confirm'],
        's6-test-virtual-native-save-experts':['experts',undefined,'research-save'],
        's6-test-virtual-native-confirm-experts':['experts','confirm','research-confirm'],
        's6-test-virtual-outline':['outline','generate','research-generate'],
        's6-test-virtual-native-save-outline':['outline',undefined,'research-save'],
        's6-test-virtual-native-confirm-outline':['outline','confirm','research-confirm'],
        's6-test-virtual-runs':['execution',undefined,'research-execute'],
        's6-test-virtual-report':['report','generate-stream','research-generate'],
      };
      const operationTarget = targets[ticket.operationId];
      const bootstrap = ['s6-test-virtual-native-initialize','s6-test-virtual-native-save-intake'].includes(ticket.operationId);
      const group = storedObject(stageStates.get(6)?.content.draft.fields['testGroup:' + source.entityId]);
      const documentFor = name => envelope.documents.find(item=>item.step === name);
      const confirmed = name => {const doc=documentFor(name);return doc?.markdown?.trim() && envelope.states?.some(state=>state.documentId === doc.documentId && ['confirmed','completed'].includes(state.status));};
      if (!operationTarget || ticket.entityRole !== 'test-virtual' || operationTarget[0] !== step || operationTarget[1] !== action || operationTarget[2] !== ticket.requestKind
        || group?.id !== source.entityId || group.archived || group.researchPath !== 'virtual'
        || !bootstrap && (!source.bound || group.source?.kind !== 'interview' || group.source.id !== researchWrite[1])) return stop('V2_RESEARCH_OPERATION_NOT_BOUND');
      if (['analysis','experts','outline','execution','report'].includes(step) && !confirmed('intake')
        || ['experts','outline','execution','report'].includes(step) && !confirmed('analysis')
        || ['outline','execution','report'].includes(step) && (!confirmed('experts') || !source.expertId)
        || ['execution','report'].includes(step) && !confirmed('outline')) return stop('V2_RESEARCH_CONFIRMATION_REQUIRED');
      let expertId;
      if (step === 'initialize') {
        if (action || !exactKeys(body,['expectedVersion']) || envelope.documents.length) return stop('V2_RESEARCH_INITIALIZE_REJECTED');
      } else if (step === 'execution') {
        if (action || !exactKeys(body,['expectedVersion','action']) || body.action !== 'start' || envelope.execution || source.executionStarted)
          return stop('V2_RESEARCH_EXECUTION_REJECTED');
        try {expertId = selectedPersona(documentFor('experts').markdown);} catch (error) {return stop(error.code ?? 'V2_RESEARCH_SINGLE_PERSONA_REQUIRED');}
        if (expertId !== source.expertId) return stop('V2_RESEARCH_SINGLE_PERSONA_REQUIRED');
      } else {
        const document = envelope.documents.find(item => item.step === step);
        if (!Number.isSafeInteger(body.expectedDocumentVersion) || body.expectedDocumentVersion !== (document?.version ?? 0)
          || !exactKeys(body, action ? ['expectedVersion','expectedDocumentVersion'] : ['expectedVersion','expectedDocumentVersion','markdown'])
          || !action && (typeof body.markdown !== 'string' || !body.markdown.trim() || body.markdown.length > 16000)
          || action === 'confirm' && (!document?.markdown?.trim() || body.expectedDocumentVersion < 1)
          || ['generate','generate-stream'].includes(action) && !['analysis','outline','report'].includes(step)) return stop('V2_RESEARCH_DOCUMENT_REJECTED');
        if (step === 'experts') {
          try {expertId = selectedPersona(action === 'confirm' ? documentFor('experts').markdown : body.markdown);} catch (error) {return stop(error.code ?? 'V2_RESEARCH_SINGLE_PERSONA_REQUIRED');}
          if (action === 'confirm' && expertId !== source.expertId) return stop('V2_RESEARCH_SINGLE_PERSONA_REQUIRED');
        }
        if (step === 'report' && (envelope.execution?.status !== 'completed' || envelope.execution.tasks?.length !== 1
          || envelope.execution.tasks[0].expertId !== source.expertId || envelope.execution.tasks[0].status !== 'completed')) return stop('V2_RESEARCH_SINGLE_TASK_NOT_COMPLETED');
      }
      if (step === 'execution') source.executionStarted = true;
      allowedWrites++; return { allow: true, kind: 'v2-research-write', researchId: researchWrite[1], beforeVersion: envelope.version,
        step,action, ...(expertId ? {expertId} : {}), ...(body.markdown !== undefined ? {expectedMarkdown:body.markdown} : {}) };
    }
    if (method === 'POST' && path === '/api/copilotkit/agent/default/run') {
      const native = decidingTicket?.expectedFields?.nativeActionPrefix;
      if (native) {
        const expected = decidingTicket.expectedFields, messages = body?.messages, last = Array.isArray(messages) && messages.at(-1);
        const prompt = typeof last?.content === 'string' ? last.content : Array.isArray(last?.content) && last.content.every(part => part?.type === 'text' && typeof part.text === 'string') ? last.content.map(part => part.text).join('') : null;
        const stageAllowed = decidingTicket.requestKind === 'asr-file' ? native === '[AIDT:TEST:LEARNING-CANDIDATES:1]' && [2,6].includes(decidingTicket.stageId)
          : V2_NATIVE_ACTION_STAGES[native] === decidingTicket.stageId;
        if (!stageAllowed || !prompt?.startsWith(native + '\n') || contentHash(expected.selector) !== contentHash(body?.forwardedProps?.aidtContext)
          || expected.threadId !== body?.forwardedProps?.chatThreadId) return stop('V2_NATIVE_CANDIDATE_NOT_BOUND');
        try { interfaceGuard.armTeachingSend({ origin: ORIGIN, projectId, stageId: decidingTicket.stageId, threadId: expected.threadId,
          actorId: actor, prompt, selector: expected.selector, skillId: expected.skillId, skillVersionId: expected.skillVersionId,
          knownMessages: expected.knownMessages, timeoutMs: 180000 }); } catch (error) { return stop(error.code ?? 'V2_NATIVE_CANDIDATE_SCOPE_REJECTED'); }
      }
      const entries = [...teachingLedger.values()].filter(entry => entry.wire === null && entry.until >= now());
      if (teachingStopped || teachingRequests >= TEACHING_TURN_LIMIT || entries.length !== 1) return stop('TEACHING_SEND_NOT_ARMED');
      const entry = entries[0];
      let checkedBody = body;
      if (decidingTicket?.requestKind === 'asr-file') {
        const attachmentIds = body?.forwardedProps?.attachmentIds;
        if (!Array.isArray(attachmentIds) || attachmentIds.length !== 1 || nativeAudio.get(attachmentIds[0])?.threadId !== entry.scope.threadId) return stop('V2_ASR_ATTACHMENT_UNVERIFIED');
        const { attachmentIds: _attachments, ...forwardedProps } = body.forwardedProps;
        checkedBody = { ...body, forwardedProps };
        const requestId = /^合成音频转写请求：([a-f0-9-]{36})$/mu.exec(entry.scope.prompt)?.[1];
        const sourceHashes = [...entry.scope.prompt.matchAll(/SHA256=([a-f0-9]{64})/gu)].map(match => match[1]);
        const audio = nativeAudio.get(attachmentIds[0]);
        if (!requestId || sourceHashes.length !== 1 || audio.sha256 !== sourceHashes[0]
          || !entry.scope.prompt.split('\n').includes(`当前测试实体：${entry.scope.selector.entityId}`)) return stop('V2_ASR_SOURCE_NOT_BOUND');
        entry.asrAudio = {attachmentId:attachmentIds[0],sourceSha256:audio.sha256,requestId};
      }
      try { entry.wire = validateTeachingWire({ url, method, body: checkedBody }, entry.scope); } catch (error) { return stop(error.code ?? 'TEACHING_WIRE_REJECTED'); }
      entry.ticket = decidingTicket;
      teachingRequests++; return { allow: true, kind: 'teaching-turn', stageId: entry.scope.stageId, threadId: entry.scope.threadId };
    }

    try { checkReferences(body, projectId, threads, resources, 0, org); } catch (error) { return stop(error.code ?? 'REFERENCE_REJECTED'); }
    if (method === 'POST' && path === '/api/pm-designs' && !target.search && designArm && now() <= designArm.until && exactKeys(body, ['name','template']) && body.name === designArm.name && body.template === 'ui') {
      designArm = null; allowedWrites++; return { allow: true, kind: 'create-design', expectedName: body.name };
    }
    const refImage = /^\/api\/pm-designs\/([A-Za-z0-9_-]{1,128})\/ref-images$/.exec(path);
    if (method === 'POST' && refImage) {
      const ticket = decidingTicket, design = refImage[1], native = designNativeStates.get(design);
      let facts; try { facts = currentDesignSource(design); } catch (error) {return stop(error.code ?? 'V2_DESIGN_SOURCE_UNVERIFIED');}
      const slot = new RegExp(`^s5-${facts.role}-source-image-upload-([1-3])$`).exec(ticket?.operationId ?? '');
      const ordinal = slot ? Number(slot[1]) : 0, source = facts.images[ordinal - 1], receipts = designSourceReceipts.get(design) ?? [];
      const file = body?.files?.[0];
      if (target.search || !ownedDesigns.has(design) || !linkedDesigns.has(design) || ticket?.requestKind !== 'design-ref-image'
        || ticket.stageId !== 5 || ticket.entityRole !== facts.role || ticket.entityId !== design || ticket.resourceId !== design
        || !slot || !source || ordinal !== receipts.length + 1 || receipts.some(receipt=>receipt.bound !== true)
        || !exactKeys(ticket.expectedFields,['sourceImage']) || contentHash(ticket.expectedFields.sourceImage) !== contentHash(source)
        || !native || native.ownerId !== actor || !Array.isArray(native.refImages) || native.refImages.length >= 3
        || native.refImages.some(image=>image.name === source.nativeName)
        || !exactKeys(body,['__multipart','files','fields']) || body.__multipart !== true || !exactKeys(body.fields,['contentType'])
        || body.fields.contentType !== source.mime || !Array.isArray(body.files) || body.files.length !== 1
        || !exactKeys(file,['filename','sizeBytes','sha256','mime']) || file.filename !== source.nativeName || file.sizeBytes !== source.bytes
        || file.sha256 !== source.sha256 || file.mime !== source.mime) return stop('V2_DESIGN_SOURCE_UPLOAD_REJECTED');
      allowedWrites++; return {allow:true,kind:'v2-design-ref-image',designId:design,source:structuredClone(source),ordinal,
        priorImages:structuredClone(native.refImages)};
    }
    if (method === 'POST' && path === `/api/projects/${projectId}/resources` && object(body) && Object.keys(body).sort().join(',') === 'kind,projectId,resourceId' && body.projectId === projectId && body.kind === 'design' && ownedDesigns.has(body.resourceId)) {
      allowedWrites++; return { allow: true, kind: 'link-design', designId: body.resourceId };
    }
    if (method === 'POST' && designId && path === `/api/pm-designs/${designId}/chat` && !target.search) {
      if (case01 && modelCount >= CASE01_LIMITS.designs) return stop('DESIGN_GENERATION_NOT_ARMED');
      if (!modelArm || now() > modelArm || !linkedDesigns.has(designId) || !object(body) || Object.keys(body).some(key => !['text', 'maxScreens','refImageIds'].includes(key)) || typeof body.text !== 'string' || !/QA|合成/u.test(body.text) || !body.text.includes(identity.run) || body.text.length > 4000 || (body.maxScreens !== undefined && body.maxScreens !== 1)) return stop('DESIGN_GENERATION_NOT_ARMED');
      if (body.refImageIds !== undefined || designSourceFacts.has(designId)) {
        let facts; try {facts = currentDesignSource(designId);} catch (error) {return stop(error.code ?? 'V2_DESIGN_SOURCE_UNVERIFIED');}
        const receipts = designSourceReceipts.get(designId) ?? [], native = designNativeStates.get(designId);
        if (!ownedDesigns.has(designId) || !native || native.ownerId !== actor || !Array.isArray(native.refImages)
          || receipts.length !== facts.images.length || receipts.some(row=>!row.bound) || !Array.isArray(body.refImageIds)
          || body.refImageIds.length !== receipts.length || new Set(body.refImageIds).size !== body.refImageIds.length
          || contentHash(body.refImageIds) !== contentHash(native.refImages.map(image=>image.id))
          || !native.refImages.every(image=>receipts.some(row=>row.binding.nativeImageId === image.id && row.binding.nativeName === image.name
            && row.binding.nativeSize === image.size && row.binding.nativeMime === image.mime))) return stop('V2_DESIGN_SOURCE_MODEL_REFS_REJECTED');
      }
      // The normal first-send UI omits maxScreens. Root approved that one request
      // with the service's default page count; no request body is rewritten here.
      modelRequestedScreens = body.maxScreens ?? 'service-default';
      modelCount++; modelArm = null; allowedWrites++; return { allow: true, kind: 'design-generation', designId };
    }
    if (method === 'POST' && designId && path === `/api/pm-designs/${designId}/prototype/patch`) {
      const op = body?.ops?.[0], root = op?.root, props = root?.props;
      if (target.search || !imageArm || now() > imageArm.until || !object(body) || Object.keys(body).sort().join(',') !== 'ops,summary'
        || !Array.isArray(body.ops) || body.ops.length !== 1 || !object(op) || Object.keys(op).sort().join(',') !== 'at,frame,op,root'
        || op.op !== 'addScreen' || op.at !== 0 || op.frame !== '图片原型' || !object(root) || Object.keys(root).sort().join(',') !== 'props,type'
        || root.type !== 'image' || !object(props) || Object.keys(props).sort().join(',') !== 'alt,src'
        || props.alt !== imageArm.name || props.src !== imageArm.source || body.summary !== imageArm.summary) return stop('DESIGN_IMAGE_NOT_ARMED');
      imageArm = null; allowedWrites++;
      return { allow: true, kind: 'design-image', designId };
    }
    if (method === 'POST' && path === `/api/projects/${projectId}/artifacts/upload`) {
      const file = body?.files?.[0], meta = body?.meta;
      if (!uploadArm || now() > uploadArm.until || body?.__multipart !== true || body.files.length !== 1 || !object(meta) || Object.keys(meta).sort().join(',') !== 'agendaSegmentId,confidential,files,onDuplicate,projectId,visibilityScope'
        || meta.projectId !== projectId || meta.agendaSegmentId !== null || meta.confidential !== false || meta.visibilityScope !== 'org-wide' || meta.onDuplicate !== 'use-existing'
        || !Array.isArray(meta.files) || meta.files.length !== 1 || JSON.stringify(meta.files[0]) !== JSON.stringify({ filename: file.filename, sizeBytes: file.sizeBytes, sha256: file.sha256 })
        || file.filename !== uploadArm.filename || file.sha256 !== uploadArm.sha256 || file.sizeBytes !== uploadArm.sizeBytes || file.mime !== uploadArm.mime) return stop('UPLOAD_NOT_ARMED');
      const fixture = uploadArm; uploadArm = null; allowedWrites++; return { allow: true, kind: 'upload', fixture };
    }
    const stage = new RegExp(`^/api/projects/${projectId}/aidt/stages/([1-6])$`).exec(path);
    if (method === 'PUT' && stage && object(body) && object(body.content) && object(body.content.draft)) {
      const n = Number(stage[1]);
      const saveKeys = ['operationId','expectedRevision','sourceStageRevisions','content', ...(body.reportEntityId === undefined ? [] : ['reportEntityId'])];
      if (!exactKeys(body,saveKeys) || body.reportEntityId !== undefined && (n !== 6 || !ENTITY.test(body.reportEntityId) || !body.content.summaryReport)
        || !new RegExp(`^${UUID}$`,'i').test(body.operationId ?? '')
        || body.expectedRevision !== (stageStates.get(n)?.revision ?? 0) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0
        || !Array.isArray(body.sourceStageRevisions) || body.sourceStageRevisions.length > 5 || body.sourceStageRevisions.some(ref => !exactKeys(ref,['stageId','revision'])
          || !Number.isInteger(ref.stageId) || ref.stageId < 1 || ref.stageId > 6 || !Number.isSafeInteger(ref.revision) || ref.revision < 1)
        || new Set(body.sourceStageRevisions.map(ref => ref.stageId)).size !== body.sourceStageRevisions.length || body.content.schemaVersion !== 1
        || Object.keys(body.content).some(key => !['schemaVersion','draft','summaryReport'].includes(key))
        || !object(body.content.draft.fields) || Object.keys(body.content.draft.fields).length > 100
        || Object.values(body.content.draft.fields).some(value => typeof value !== 'string' || value.length > 6000)
        || !Array.isArray(body.content.draft.ideas) || body.content.draft.ideas.length > 100 || typeof body.content.draft.selectedIdeaId !== 'string') return stop('V2_STAGE_SAVE_SCHEMA_REJECTED');
      const explicitlyArmed = arm && arm.stage === n && arm.remaining > 0 && now() <= arm.until || decidingTicket?.requestKind === 'stage-save' && decidingTicket.stageId === n;
      const projection = [...teachingLedger.values()].find(entry => entry.wire && !entry.projected && (
        n === 4 && entry.brainstormUntil >= now() && validBrainstormProjection(stageStates.get(4), body, entry.scope.selector.entityId) ||
        n === 6 && entry.planUntil >= now() && validTestPlanProjection(stageStates.get(6), body, entry.scope.selector.entityId)));
      if (!explicitlyArmed && !projection) return stop('STAGE_SAVE_NOT_ARMED');
      let sourceImageSave, researchSourceBinding;
      if (n === 6) {
        const previous = stageStates.get(6), oldFields = previous?.content.draft.fields ?? {}, newFields = body.content.draft.fields;
        const changed = Object.keys(oldFields).filter(key=>key.startsWith('testGroup:')).flatMap(key=>{
          const old=storedObject(oldFields[key]), next=storedObject(newFields[key]);
          return old?.researchPath === 'virtual' && contentHash(old.source) !== contentHash(next?.source) ? [{key,old,next}] : [];
        });
        if (changed.length) {
          const row=changed[0], ticket=decidingTicket, sourceId=row.next?.source?.id, source=researchSources.get(sourceId);
          const retained=value=>Object.fromEntries(Object.entries(value ?? {}).filter(([key])=>!['source','evidenceGap','confirmedFromMessageId'].includes(key)));
          const remaining=fields=>Object.fromEntries(Object.entries(fields).filter(([key])=>![row.key,'reflectionConfirmed'].includes(key)));
          if (changed.length !== 1 || ticket?.operationId !== 's6-test-virtual-native-source-binding' || ticket.requestKind !== 'stage-save'
            || ticket.stageId !== 6 || ticket.entityRole !== 'test-virtual' || ticket.entityId !== row.old.id || row.old.archived || row.old.source
            || row.old.confirmedFromMessageId || row.next?.confirmedFromMessageId || !source || source.entityId !== row.old.id || source.bound
            || !exactKeys(row.next?.source,['kind','id']) || row.next.source.kind !== 'interview'
            || row.next.evidenceGap !== '仅有虚拟用户模拟反馈，尚未开展真实用户验证。'
            || contentHash(retained(row.old)) !== contentHash(retained(row.next))
            || contentHash(remaining(oldFields)) !== contentHash(remaining(newFields)) || newFields.reflectionConfirmed
            || contentHash({...body.content.draft,fields:{}}) !== contentHash({...previous.content.draft,fields:{}})
            || contentHash({...body.content,draft:null}) !== contentHash({...previous.content,draft:null})
            || contentHash(body.sourceStageRevisions) !== contentHash(previous.sourceStageRevisions)) return stop('V2_RESEARCH_SOURCE_BINDING_REJECTED');
          researchSourceBinding={researchId:sourceId,expectedContent:structuredClone(body.content)};
        } else if (decidingTicket?.operationId === 's6-test-virtual-native-source-binding') return stop('V2_RESEARCH_SOURCE_BINDING_REJECTED');
      }
      if (n === 5) {
        const oldFields = stageStates.get(5)?.content.draft.fields ?? {}, newFields = body.content.draft.fields;
        const changed = [...new Set([...Object.keys(oldFields),...Object.keys(newFields)])]
          .filter(key=>/^prototypeText:[A-Za-z0-9_-]+:prototypeSourceImages$/.test(key) && (oldFields[key] ?? '') !== (newFields[key] ?? ''));
        if (changed.length) {
          const ticket = decidingTicket, design = ticket?.entityId;
          let facts; try {facts = currentDesignSource(design);} catch (error) {return stop(error.code ?? 'V2_DESIGN_SOURCE_UNVERIFIED');}
          const key = `prototypeText:${design}:prototypeSourceImages`, receipts = designSourceReceipts.get(design) ?? [];
          const slot = new RegExp(`^s5-${facts.role}-source-image-save-([1-3])$`).exec(ticket?.operationId ?? '');
          const ordinal = slot ? Number(slot[1]) : 0, expected = {...facts.textBasis,images:receipts.map(row=>row.binding)};
          const onlyFields = {...newFields,[key]:oldFields[key]};
          if (oldFields[key] === undefined) delete onlyFields[key];
          if (ticket?.requestKind !== 'stage-save' || ticket.stageId !== 5 || ticket.entityRole !== facts.role || !slot || ordinal !== receipts.length
            || !receipts.length || receipts.at(-1).bound || receipts.slice(0,-1).some(row=>!row.bound)
            || changed.length !== 1 || changed[0] !== key || contentHash(storedObject(newFields[key])) !== contentHash(expected)
            || contentHash(onlyFields) !== contentHash(oldFields)
            || contentHash({...body.content.draft,fields:{}}) !== contentHash({...stageStates.get(5).content.draft,fields:{}})
            || contentHash({...body.content,draft:null}) !== contentHash({...stageStates.get(5).content,draft:null})
            || contentHash(body.sourceStageRevisions) !== contentHash(stageStates.get(5).sourceStageRevisions)) return stop('V2_DESIGN_SOURCE_SAVE_REJECTED');
          sourceImageSave = {designId:design,ordinal,expectedContent:structuredClone(body.content)};
        } else if (/^s5-prototype-(?:single|three)-source-image-save-[1-3]$/.test(decidingTicket?.operationId ?? '')) return stop('V2_DESIGN_SOURCE_SAVE_REJECTED');
      }
      const before = snapshots.get(n) ?? new Set();
      let next;
      try { next = confirmations(body.content); } catch (error) { return stop(error.code ?? 'CONFIRMATION_REJECTED'); }
      const changes = [...next].some(entry => !before.has(entry));
      if (changes && (!explicitlyArmed || !(arm?.confirmation || decidingTicket?.expectedFields?.confirmation === true))) return stop('CONFIRMATION_NOT_ARMED');
      if (projection) projection.projected = true;
      else if (arm) arm.remaining--;
      if (Object.keys(body.content.draft).some(key => !ROOTS.has(key))) return stop('DRAFT_SCHEMA_REJECTED');
      allowedWrites++; return { allow: true, kind: 'save-stage', stageId: n, expectedRevision: body.expectedRevision,
        ...(sourceImageSave ? {sourceImageSave} : {}), ...(researchSourceBinding ? {researchSourceBinding} : {}) };
    }
    const reconcile = new RegExp(`^/api/projects/${projectId}/aidt/stages/([12])/entities/(${UUID})/reconcile$`).exec(path);
    if (method === 'POST' && reconcile) {
      const stageId = Number(reconcile[1]), entityId = reconcile[2];
      const key = `${stageId === 1 ? 'problemEntity' : 'interviewRecord'}:${entityId}`;
      let entity;
      try { entity = JSON.parse(stageStates.get(stageId)?.content.draft.fields[key]); } catch { /* Never create an unobserved target. */ }
      if (reconcileCount >= 64 || target.search || body != null || !ordinaryVerified || entity?.id !== entityId) return stop('RECONCILE_ENTITY_NOT_VERIFIED');
      reconcileCount++; allowedWrites++; return { allow: true, kind: 'reconcile-entity', stageId, entityId };
    }
    const entity = new RegExp(`^/api/projects/${projectId}/aidt/stages/([1-6])/entities/([^/]+)/thread$`).exec(path);
    if (method === 'PUT' && entity && (ENTITY.test(entity[2]) || entity[2] === 'group-report') && object(body) && Object.keys(body).join(',') === 'purpose' && ['stage', 'report'].includes(body.purpose)) {
      allowedWrites++; return { allow: true, kind: 'entity-thread', stageId: Number(entity[1]), entityId: entity[2], purpose: body.purpose };
    }
    if (method === 'POST' && path === '/api/chat/threads/mutate' && object(body) && body.op === 'create'
        && Object.keys(body).sort().join(',') === 'expectedVersion,groupId,op,projectId,reason,threadId,title,visibilityScope'
        && body.projectId === projectId && body.threadId === null && body.groupId === null && body.expectedVersion === null
        && body.reason === null && typeof body.title === 'string' && body.title.length > 0 && body.title.length <= 180 && body.visibilityScope === 'plenary') {
      const stage = /^\[AIDT ([1-6])\] /.exec(body.title);
      if (!stage || decidingTicket?.stageId !== Number(stage[1])) return stop('V2_STAGE_THREAD_NOT_BOUND');
      allowedWrites++; return { allow: true, kind: 'create-thread', stageId: Number(stage[1]), purpose: 'stage' };
    }
    // Exact owned-thread skill mounting is required by the native teaching Chat, not a global capability change.
    if (method === 'POST' && [...threads].some(id => path === `/api/threads/${encodeURIComponent(id)}/skill-mounts` && body?.threadId === id)
        && object(body) && Object.keys(body).sort().join(',') === 'expectedVersion,skillIds,threadId'
        && Array.isArray(body.skillIds) && body.skillIds.length === 1 && teachingSkills.has(body.skillIds[0])
        && target.searchParams.get('projectId') === projectId && [...target.searchParams.keys()].every(key => key === 'projectId')
        && typeof body.expectedVersion === 'string' && body.expectedVersion.length > 0 && body.expectedVersion.length <= 200) {
      allowedWrites++; return { allow: true, kind: 'mount-owned-thread' };
    }
    return stop('MUTATION_OUT_OF_SCOPE');
  }
  function decide(request) {
    let businessWrite=false;
    try { businessWrite=case01BusinessWrite(request); } catch { return stop('TARGET_REJECTED'); }
    if(businessWrite && case01PhysicalWrites >= CASE01_LIMITS.physicalWrites) return stop('WRITE_COUNT_BOUND');
    let ticket;
    const optional = request.method === 'POST' && (request.url.endsWith('/api/copilotkit/agent/default/suggest')
      || request.body?.forwardedProps?.toolChoice?.function?.name === 'copilotkitSuggest');
    if (projectId && request.method !== 'GET' && !optional) {
      try { ticket = claimRequest(request); } catch (error) { return stop(error.code ?? 'V2_REQUEST_SLOT_REJECTED'); }
    }
    decidingTicket = ticket;
    let decision;
    try { decision = decideRequest(request); } catch (error) { return stop(error.code ?? 'V2_REQUEST_REJECTED'); } finally { decidingTicket = null; }
    if (businessWrite && decision.allow) case01PhysicalWrites++;
    if (ticket && decision.allow) {
      ticket.state = 'SENT';
      ticket.ledger.markOperationSent(ticket.operationId, ticket.scope);
      requestTickets.set(decision, ticket);
    }
    if (request.method === 'GET') {
      let path; try { path = new URL(request.url).pathname; } catch { /* Classify invalid targets without retaining request data. */ }
      const category = path === '/api/capabilities' ? 'nativeAgentCatalog' : ['/api/copilotkit', '/api/copilotkit/info'].includes(path) ? 'runtimeMetadata' : 'other';
      (decision.allow ? readCategories : readDenials)[category]++;
      // Preserve the issued decision identity used by one-use read receipts.
      // Cloning here would discard the Survey audience provenance WeakMap key.
      decision.readCategory = category;
      return decision;
    }
    return decision;
  }
  function observe(decision, status, response) {
    survey.observe(decision, status, response);
    if (decision.kind === 'survey-create') resources.add(survey.receipt().id);
    if (decision.allow && ['nativeAgentCatalog', 'runtimeMetadata'].includes(decision.readCategory) && Number.isInteger(status) && status >= 100 && status <= 599) {
      if (metadataHttpStatuses.length < 128) metadataHttpStatuses.push({ category: decision.readCategory, status });
      else metadataHttpStatusesTruncated = true;
    }
    if (status >= 300 && status < 400) throw new ProbeFailure('REDIRECT_REJECTED');
    if (decision.kind === 'v2-stage-version' && status === 200 && response?.stage) {
      if (response.stage.stageId !== decision.stageId || response.stage.revision !== decision.revision) throw new ProbeFailure('V2_STAGE_VERSION_CHANGED');
      rememberStageVersion(response.stage);
    } else if (decision.kind === 'v2-stage-history' && status === 200) {
      if (!Array.isArray(response?.items) || response.items.length > 1 || response.items.some(stage=>stage.stageId !== decision.stageId || stage.revision >= decision.beforeRevision))
        throw new ProbeFailure('V2_STAGE_VERSION_CHANGED');
      for (const stage of response.items) rememberStageVersion(stage);
    } else if (decision.kind === 'v2-design-ref-image') {
      const image = response?.image, native = response?.project, receipts = designSourceReceipts.get(decision.designId) ?? [];
      if (![200,201].includes(status) || !exactKeys(response,['image','project']) || native?.id !== decision.designId || native.ownerId !== actor
        || !/^[A-Za-z0-9_-]{1,256}$/.test(image?.id ?? '') || resources.has(image.id) || image.name !== decision.source.nativeName
        || image.size !== decision.source.bytes || image.mime !== decision.source.mime || !Array.isArray(native.refImages)
        || native.refImages.length !== decision.priorImages.length + 1 || native.refImages.length > 3
        || contentHash(native.refImages.find(item=>item.id === image.id)) !== contentHash(image)
        || !decision.priorImages.every(prior=>native.refImages.some(item=>contentHash(item) === contentHash(prior)))
        || receipts.length !== decision.ordinal - 1) throw new ProbeFailure('V2_DESIGN_SOURCE_RECEIPT_REJECTED');
      const source = decision.source;
      receipts.push({bound:false,binding:{sourceRunId:source.sourceRunId,artifactId:source.artifactId,versionId:source.versionId,sha256:source.sha256,
        stage4Revision:source.stage4Revision,brainstormId:source.brainstormId,nativeImageId:image.id,nativeName:image.name,nativeSize:image.size,nativeMime:image.mime}});
      designSourceReceipts.set(decision.designId,receipts); designNativeStates.set(decision.designId,structuredClone(native)); resources.add(image.id);
    } else if (decision.kind === 'v2-asr-permission-once') {
      if (status === 200 && (!exactKeys(response,['runId','permissionRequestId']) || response.runId !== decision.runId
        || response.permissionRequestId !== decision.permissionRequestId)) throw new ProbeFailure('V2_ASR_PERMISSION_RECEIPT_MISMATCH');
      observedAsrRuns.delete(decision.runId);
    } else if (decision.kind === 'v2-research-create') {
      if (![200,201].includes(status) || !ENTITY.test(response?.interviewId ?? '') || response.scope?.kind !== 'project' || response.scope.projectId !== projectId
        || response.scope.researchProjectId !== null || response.studyEvidenceMode !== 'simulated' || researchSources.has(response.interviewId)) throw new ProbeFailure('V2_RESEARCH_OWNERSHIP_UNVERIFIED');
      researchSources.set(response.interviewId, { entityId: decision.entityId, documents: new Map() }); resources.add(response.interviewId);
    } else if (['v2-research-envelope','v2-research-write'].includes(decision.kind) && status === 200) {
      const source = researchSources.get(decision.researchId);
      if (!source || response?.interviewId !== decision.researchId || !Number.isSafeInteger(response.version) || response.version < 1
        || decision.kind === 'v2-research-write' && response.version <= decision.beforeVersion || !Array.isArray(response.documents) || response.documents.length > 32
        || response.revisionId !== null && !ENTITY.test(response.revisionId ?? '')) throw new ProbeFailure('V2_RESEARCH_ENVELOPE_UNVERIFIED');
      for (const document of response.documents) {
        if (!ENTITY.test(document?.documentId ?? '') || !Number.isSafeInteger(document.version) || document.version < 1 || typeof document.markdown !== 'string'
          || document.markdown.length > 262144 || document.evidenceMode !== 'simulated' || !/^[a-f0-9]{64}$/.test(document.contentHash ?? '')
          || createHash('sha256').update(document.markdown).digest('hex') !== document.contentHash) throw new ProbeFailure('V2_RESEARCH_DOCUMENT_UNVERIFIED');
        source.documents.set(document.documentId + ':' + document.version, { contentHash: document.contentHash, step: document.step }); resources.add(document.documentId);
      }
      if (decision.kind === 'v2-research-write') {
        const doc = response.documents.find(document=>document.step === decision.step);
        if (decision.expectedMarkdown !== undefined && doc?.markdown !== decision.expectedMarkdown) throw new ProbeFailure('V2_RESEARCH_SAVED_DOCUMENT_CHANGED');
        if (decision.action === 'confirm' && (!doc || !response.states?.some(state=>state.documentId === doc.documentId && ['confirmed','completed'].includes(state.status))))
          throw new ProbeFailure('V2_RESEARCH_CONFIRMATION_REQUIRED');
        if (decision.step === 'experts') {
          if (!doc || selectedPersona(doc.markdown) !== decision.expertId) throw new ProbeFailure('V2_RESEARCH_SINGLE_PERSONA_REQUIRED');
          source.expertId=decision.expertId;
        }
        if (decision.step === 'execution' && (response.execution?.status !== 'completed' || response.execution.tasks?.length !== 1
          || response.execution.tasks[0].expertId !== decision.expertId || response.execution.tasks[0].status !== 'completed'))
          throw new ProbeFailure('V2_RESEARCH_SINGLE_TASK_NOT_COMPLETED');
      }
      if (response.revisionId) resources.add(response.revisionId);
      source.envelope = structuredClone(response);
    } else if (decision.kind === 'v2-research-view' && status === 200) {
      if (response?.interviewId !== decision.researchId || response.scope?.kind !== 'project' || response.scope.projectId !== projectId
        || response.studyEvidenceMode !== 'simulated') throw new ProbeFailure('V2_RESEARCH_OWNERSHIP_UNVERIFIED');
    } else if (decision.kind === 'v2-native-artifacts' && status === 200) {
      if (!Array.isArray(response?.artifacts) || response.artifacts.length > 64) throw new ProbeFailure('V2_NATIVE_ARTIFACTS_UNVERIFIED');
      for (const artifact of response.artifacts) {
        if (artifact.threadId !== decision.threadId || !ENTITY.test(artifact.artifactId ?? '') || !Array.isArray(artifact.versions) || artifact.versions.length > 32) throw new ProbeFailure('V2_NATIVE_ARTIFACTS_UNVERIFIED');
        for (const version of artifact.versions) {
          if (!ownedRuns.has(version.producedByRunId)) continue;
          if (!ENTITY.test(version.attachmentId ?? '') || !Number.isSafeInteger(version.version) || version.version < 1 || !Number.isSafeInteger(version.sizeBytes)
            || version.sizeBytes < 1 || version.sizeBytes > 524288) throw new ProbeFailure('V2_NATIVE_ARTIFACTS_UNVERIFIED');
          publishedArtifacts.set(artifact.artifactId + ':' + version.version, { threadId: decision.threadId, ...version });
          resources.add(artifact.artifactId); resources.add(version.attachmentId); resources.add(version.producedByRunId);
        }
      }
    } else if (decision.kind === 'login') {
      if (status !== 200 || !validLoginBody(response)) throw new ProbeFailure('AUTHENTICATION_FAILED');
      actor = response.userId; org = response.orgs[0];
    } else if (decision.kind === 'create-project') {
      if (![200, 201].includes(status) || !PROJECT.test(response?.id ?? '') || response.kind !== 'general' || response.status !== 'active') throw new ProbeFailure('PROJECT_RESPONSE_REJECTED');
      candidate = response.id;
    } else if (decision.kind === 'create-design') {
      const item = response?.project;
      if (![200, 201].includes(status) || !/^[A-Za-z0-9_-]{1,128}$/.test(item?.id ?? '') || item.ownerId !== actor || item.name !== decision.expectedName || item.template !== 'ui' || item.frames?.length !== 0 || item.share !== null || ownedDesigns.has(item.id)) throw new ProbeFailure('DESIGN_OWNERSHIP_UNVERIFIED');
      designId = item.id; resources.add(designId); ownedDesigns.add(designId);
      designNativeStates.set(designId,structuredClone(item));
      const ticket = requestTickets.get(decision); if (ticket) entityRoles.set('5:' + designId, ticket.entityRole);
    } else if (decision.kind === 'design-list' && status === 200) {
      if (!Array.isArray(response?.items)) throw new ProbeFailure('DESIGN_OWNERSHIP_UNVERIFIED');
      for (const item of response.items) if (ownedDesigns.has(item.id)) {
        if (item.ownerId !== actor || !Array.isArray(item.refImages) || item.refImages.length > 3) throw new ProbeFailure('DESIGN_OWNERSHIP_UNVERIFIED');
        designNativeStates.set(item.id,structuredClone(item));
      }
    } else if (decision.kind === 'link-design' && [200, 201, 204].includes(status)) {
      linkedDesigns.add(decision.designId);
    } else if (decision.kind === 'design-image' && status === 200) {
      if (response?.project?.id !== designId || response.project.ownerId !== actor || response.project.prototype?.[0]?.type !== 'image') throw new ProbeFailure('DESIGN_IMAGE_RESPONSE_REJECTED');
    } else if (decision.kind === 'design-versions' && status === 200) {
      for (const item of response?.items ?? []) { if (!/^[A-Za-z0-9_-]{1,256}$/.test(item.id ?? '')) throw new ProbeFailure('DESIGN_VERSION_UNVERIFIED'); resources.add(item.id); }
    } else if (decision.kind === 'design-generation') {
      modelReceipt = { attempted: true, httpStatus: status, replySource: ['model', 'fallback'].includes(response?.reply?.source) ? response.reply.source : 'unknown', generatedFrames: Array.isArray(response?.project?.frames) ? response.project.frames.length : 0 };
      if (status === 200 && (response?.project?.id !== designId || response.project.ownerId !== actor)) throw new ProbeFailure('DESIGN_OWNERSHIP_UNVERIFIED');
    } else if (decision.kind === 'case01-stage-file-upload') {
      stageFiles.observe(decision, status, response);
    } else if (decision.kind === 'v2-audio-upload') {
      if (![200,201].includes(status) || !/^[A-Za-z0-9_.:-]{1,256}$/.test(response?.id ?? '') || response.filename !== decision.fixture.filename
        || response.bytes !== decision.fixture.sizeBytes || response.mime !== decision.fixture.mime || nativeAudio.has(response.id)) throw new ProbeFailure('V2_AUDIO_ATTACHMENT_RESPONSE_REJECTED');
      nativeAudio.set(response.id, { threadId: decision.threadId, ...decision.fixture }); resources.add(response.id);
    } else if (decision.kind === 'upload') {
      const run = response?.runs?.[0];
      if (![200, 201, 202].includes(status) || response?.runs?.length !== 1 || run.duplicateHit || !/^[A-Za-z0-9_-]{1,256}$/.test(run.ingestionRunId ?? '') || !/^[A-Za-z0-9_-]{1,256}$/.test(run.artifactId ?? '') || resources.has(run.artifactId) || uploads.has(run.ingestionRunId)) throw new ProbeFailure('UPLOAD_RECEIPT_REJECTED');
      resources.add(run.artifactId); resources.add(run.ingestionRunId); uploads.set(run.ingestionRunId, { ...decision.fixture, artifactId: run.artifactId });
    } else if (decision.kind === 'entity-thread' || decision.kind === 'create-thread') {
      if (status === 200 || status === 201) {
        if (!/^(?:thr[-_])[a-zA-Z0-9_-]{1,180}$/.test(response?.threadId ?? '')) throw new ProbeFailure('THREAD_RESPONSE_REJECTED');
        threads.add(response.threadId);
        threadCoordinates.set(response.threadId, { stageId: decision.stageId, entityId: decision.entityId, purpose: decision.purpose });
        const ticket = requestTickets.get(decision);
        if (ticket) { threadRoles.set(response.threadId, ticket.entityRole); if (decision.entityId) entityRoles.set(decision.stageId + ':' + decision.entityId, ticket.entityRole); }
      }
    } else if (decision.kind === 'skill-catalog' && status === 200 && Array.isArray(response?.items)) {
      for (const item of response.items) if (identity.teachingSkillNames?.includes(item.platformStableName) && item.status === '已启用' && typeof item.currentVersionId === 'string' && item.currentVersionId && typeof item.skillId === 'string') { teachingSkills.add(item.skillId); skillCatalog.set(item.skillId, { stableName: item.platformStableName, currentVersionId: item.currentVersionId }); }
    } else if (decision.kind === 'thread-detail' && status === 200) {
      if (response?.thread?.id !== decision.threadId || response.thread.projectId !== projectId) throw new ProbeFailure('TEACHING_THREAD_PROJECT_MISMATCH');
      threadFacts.set(decision.threadId, { writable: response.thread.archived === false && response.capabilities?.includes('composer.send') === true });
    } else if (decision.kind === 'thread-pins' && status === 200) {
      if (!Array.isArray(response?.temporary) || response.temporary.some(pin => pin.threadId !== decision.threadId)) throw new ProbeFailure('TEACHING_THREAD_PINS_INVALID');
      threadPins.set(decision.threadId, response.temporary.filter(pin => pin.removedAt === null));
    } else if (decision.kind === 'owned-teaching-run-read' && status === 200 && response?.snapshotHash !== undefined) {
      const entries = [...teachingLedger.values()].filter(entry => entry.accepted?.runId === decision.runId);
      if (entries.length !== 1 || response.runId !== decision.runId || response.projectId !== projectId
        || response.stageId !== entries[0].scope.selector.stageId || response.purpose !== entries[0].scope.selector.purpose
        || response.skillVersionId !== entries[0].scope.skillVersionId || !/^[a-f0-9]{64}$/.test(response.snapshotHash)
        || entries[0].snapshotHash && entries[0].snapshotHash !== response.snapshotHash) throw new ProbeFailure('V2_NATIVE_SNAPSHOT_MISMATCH');
      entries[0].snapshotHash = response.snapshotHash;
    } else if (decision.kind === 'owned-teaching-run-read' && status === 200) {
      const entries = [...teachingLedger.values()].filter(entry => entry.accepted?.runId === decision.runId && entry.ticket?.requestKind === 'asr-file');
      if (entries.length) {
        if (entries.length !== 1 || response.runId !== decision.runId || response.threadId !== entries[0].scope.threadId
          || response.inputMessageId !== entries[0].accepted.inputMessageId || Buffer.byteLength(JSON.stringify(response)) > 524288)
          throw new ProbeFailure('V2_ASR_OBSERVED_RUN_MISMATCH');
        observedAsrRuns.set(decision.runId,{at:now(),run:structuredClone(response)});
      }
    } else if (decision.kind === 'thread-messages' && status === 200) {
      const rows = Array.isArray(response) ? response : response?.messages;
      if (!Array.isArray(rows) || rows.length > 100 || !Array.isArray(response) && response.nextCursor != null) throw new ProbeFailure('TEACHING_MESSAGE_READ_INVALID');
      messageSnapshots.set(decision.threadId, rows);
      for (const entry of teachingLedger.values()) if (entry.wire && entry.scope.threadId === decision.threadId) {
        const accepted = identifyOwnedTeachingRun(response, entry.scope, entry.wire);
        if (accepted) { if (entry.accepted && entry.accepted.runId !== accepted.runId) throw new ProbeFailure('TEACHING_RUN_BINDING_CHANGED'); entry.accepted = accepted; ownedRuns.add(accepted.runId); }
      }
    } else if ((decision.kind === 'save-stage' || decision.kind === 'get-stage') && status === 200 && response?.stage) {
      if (response?.stage?.projectId !== projectId || response.stage.stageId !== decision.stageId || !Number.isSafeInteger(response.stage.revision) || response.stage.revision < 1
        || decision.kind === 'save-stage' && response.stage.revision !== decision.expectedRevision + 1) throw new ProbeFailure('STAGE_RESPONSE_REJECTED');
      snapshots.set(decision.stageId, confirmations(response.stage.content));
      stageStates.set(decision.stageId, response.stage);
      rememberStageVersion(response.stage);
      if (decision.sourceImageSave) {
        const binding = decision.sourceImageSave, receipts = designSourceReceipts.get(binding.designId);
        if (!receipts || receipts.length !== binding.ordinal || receipts.at(-1).bound || contentHash(response.stage.content) !== contentHash(binding.expectedContent))
          throw new ProbeFailure('V2_DESIGN_SOURCE_SAVE_RECEIPT_REJECTED');
        receipts.at(-1).bound = true;
      }
      if (decision.researchSourceBinding) {
        const binding=decision.researchSourceBinding, source=researchSources.get(binding.researchId);
        if (!source || source.bound || contentHash(response.stage.content) !== contentHash(binding.expectedContent)) throw new ProbeFailure('V2_RESEARCH_SOURCE_BINDING_REJECTED');
        source.bound=true;
      }
      for (const idea of response.stage.content.draft.ideas ?? []) if (ENTITY.test(idea.id ?? '')) resources.add(idea.id);
      for (const [key, raw] of Object.entries(response.stage.content.draft.fields ?? {})) {
        if (!/^(?:problemEntity|interviewRecord|definitionPersona|definitionHmw|definitionSurprise|ideaBrainstorm|testGroup):/.test(key)) continue;
        try { const entity = JSON.parse(raw); if (ENTITY.test(entity.id ?? '') && key.endsWith(':' + entity.id)) resources.add(entity.id); } catch { /* Malformed rows never become owned references. */ }
      }
    }
    const ticket = requestTickets.get(decision);
    if (ticket && decision.kind !== 'teaching-turn') {
      if (ticket.state !== 'SENT') throw new ProbeFailure('V2_REQUEST_RESPONSE_REPLAYED');
      if (status >= 500 || status < 200 || status >= 300 && status < 400) { stop('V2_UNKNOWN_MUTATION_OUTCOME'); return; }
      ticket.ledger.settleOperation(ticket.operationId, { scope: ticket.scope, outcome: status < 300 ? 'succeeded' : 'failed',
        receipt: { verified: true, httpStatus: status, sha256: contentHash({ requestSha256: ticket.requestSha256, status, response }) } });
      ticket.state = status < 300 ? 'SUCCEEDED' : 'FAILED';
    }
  }
  return interfaceGuard = { decide, observe, fail: stop, fatal: () => fatal,
    armV2Operation,
    registerDesignSourceImages: coordinates => {
      runtime();
      const facts = sourceImageFacts(coordinates), known = designSourceFacts.get(coordinates.designId);
      if (known && contentHash(known) !== contentHash(facts)) throw new ProbeFailure('V2_DESIGN_SOURCE_CHANGED');
      designSourceFacts.set(coordinates.designId,structuredClone(facts));
      return structuredClone({designId:coordinates.designId,entityRole:facts.role,images:facts.images});
    },
    nativeTeachingState: operationId => {
      const matches = [...teachingLedger.values()].filter(entry => entry.ticket?.operationId === operationId);
      if (matches.length !== 1) return null;
      const entry = matches[0];
      return structuredClone({ scope: entry.scope, wire: entry.wire, accepted: entry.accepted, snapshotHash: entry.snapshotHash });
    },
    registerEntityRole: (stageId, entityId, entityRole) => {
      if (!resources.has(entityId) || ![...operationMap.values()].some(row => row.stage === stageId && row.entityRole === entityRole)) throw new ProbeFailure('V2_ENTITY_ROLE_UNVERIFIED');
      const key = stageId + ':' + entityId;
      if (entityRoles.has(key) && entityRoles.get(key) !== entityRole) throw new ProbeFailure('V2_ENTITY_ROLE_CHANGED');
      entityRoles.set(key, entityRole);
    },
    stopTeaching: () => { teachingStopped = true; stop('V2_UNKNOWN_TEACHING_OUTCOME'); },
    teachingStopped: () => teachingStopped,
    teachingReadsToBind: () => [...teachingLedger.values()].filter(entry => entry.wire && !entry.accepted).map(entry => `/api/chat/threads/${encodeURIComponent(entry.scope.threadId)}/messages?limit=100`),
    teachingPin: (stageId, threadId, entityId) => {
      const coordinates = threadCoordinates.get(threadId);
      const isReport = stageId === 6 && entityId === 'group-report';
      if (!coordinates || coordinates.stageId !== stageId || coordinates.purpose !== (isReport ? 'report' : 'stage') || (entityId !== undefined && coordinates.entityId !== entityId)) return null;
      const expected = identity.teachingSkillNames?.[isReport ? 6 : stageId - 1];
      const pins = (threadPins.get(threadId) ?? []).filter(pin => skillCatalog.get(pin.skillId)?.stableName === expected);
      return pins.length === 1 ? { skillId: pins[0].skillId, skillVersionId: pins[0].versionId } : null;
    },
    recordPendingProblem: receipt => {
      const entry = [...teachingLedger.values()].find(item => item.scope.stageId === 1
        && item.scope.threadId === receipt.threadId && item.accepted?.runId === receipt.runId
        && item.accepted.inputMessageId === receipt.inputMessageId);
      if (!entry || entry.scope.syntheticProblemFixture || receipt.projectId !== projectId || receipt.stageId !== 1
        || receipt.knownConfirmTaskIntent !== true || receipt.toolName !== 'confirm_task_intent') throw new ProbeFailure('SYNTHETIC_PREREQUISITE_NOT_BOUND');
      isolatedProblemReceipt = { threadId: entry.scope.threadId, entityId: entry.scope.selector.entityId };
    },
    completeTeaching: proof => {
      const matches = [...teachingLedger.values()].filter(entry => entry.scope.threadId === proof.threadId
        && entry.accepted?.runId === proof.runId && entry.accepted.inputMessageId === proof.inputMessageId);
      if (matches.length !== 1) throw new ProbeFailure('TEACHING_COMPLETION_NOT_BOUND');
      if (!/^[a-f0-9]{64}$/.test(proof.snapshotHash ?? '') || matches[0].snapshotHash && matches[0].snapshotHash !== proof.snapshotHash) throw new ProbeFailure('V2_NATIVE_SNAPSHOT_MISMATCH');
      stageFiles?.bind(matches[0].scope, proof);
      matches[0].completed = true;
      const ticket = matches[0].ticket;
      if (!ticket || ticket.state !== 'SENT') throw new ProbeFailure('V2_TEACHING_SLOT_NOT_BOUND');
      ticket.ledger.settleOperation(ticket.operationId, { scope: ticket.scope, outcome: 'succeeded', receipt: { verified: true, sha256: contentHash(proof) } });
      ticket.state = 'SUCCEEDED';
    },
    armStageText: scope => {
      if (!stageFiles) throw new ProbeFailure('CASE01_STAGE_FILE_NOT_BOUND');
      const selector = validateTeachingScope(scope), coordinates = threadCoordinates.get(scope.threadId);
      if (!ordinaryVerified || scope.projectId !== projectId || scope.actorId !== actor || selector.purpose !== 'stage' || coordinates?.stageId !== scope.stageId || coordinates.entityId !== selector.entityId || coordinates.purpose !== 'stage' || !threadFacts.get(scope.threadId)?.writable) throw new ProbeFailure('CASE01_STAGE_FILE_NOT_BOUND');
      const file = stageFiles.arm(scope), role = entityRoles.get(scope.stageId + ':' + selector.entityId);
      armV2Operation({ operationId: `case01-stage-${scope.stageId}-attachment`, kind: 'write', requestKind: 'chat-stage-text-upload', stageId: scope.stageId, entityRole: role, entityId: selector.entityId });
      return file;
    },
    stageTextReceipt: stageId => stageFiles?.receipt(stageId) ?? null,
    armTeachingSend: scope => {
      validateTeachingScope(scope);
      stageFiles?.assertSend(scope);
      let ticketCandidates = decidingTicket ? [decidingTicket] : [...tickets.values()].filter(ticket => ticket.state === 'ARMED' && ticket.stageId === scope.stageId && ['teaching-send','asr-file'].includes(ticket.requestKind));
      if (!ticketCandidates.length) {
        const entity = scope.selector.entityId;
        const record = prefix => { try { return JSON.parse(stageStates.get(scope.stageId)?.content.draft.fields[prefix + entity] ?? '{}'); } catch { return {}; } };
        const role = entityRoles.get(scope.stageId + ':' + entity) ?? threadRoles.get(scope.threadId)
          ?? (scope.stageId === 1 ? 'problem-main' : scope.stageId === 2 ? record('interviewRecord:').kind === 'observation' ? 'source-observation' : 'source-interview'
            : scope.stageId === 3 ? 'surprise-main' : scope.stageId === 4 ? 'method-' + brainstormRecord(stageStates.get(4), entity)?.method : scope.stageId === 6 && entity === 'group-report' ? 'group-report' : undefined);
        const earlier = [...teachingLedger.values()].filter(entry => entry.completed && entry.scope.threadId === scope.threadId).length;
        const suffix = scope.stageId === 1 ? scope.problemRevision ? 'student-dynamic-response' : 'student-initial'
          : scope.stageId === 2 ? scope.interviewFinding ? 'finding-feedback' : scope.interviewGuideRevision ? 'guide-revised' : 'guide-initial'
            : scope.stageId === 3 ? 'student-none' : scope.stageId === 4 ? brainstormRecord(stageStates.get(4), entity)
              ? earlier === 0 ? 'student-round-1' : earlier === 1 ? 'student-round-2' : null : 'description-feedback'
              : scope.stageId === 5 ? 'student-initial'
                : scope.stageId === 6 ? scope.selector.purpose === 'summary' ? 'final-report' : scope.testPlan === true ? 'student-task-initial' : 'student-result-review' : null;
        const candidates = [...operationMap.values()].filter(row => row.kind === 'teaching' && row.stage === scope.stageId && row.entityRole === role && suffix && row.id.endsWith('-' + suffix) && !tickets.has(row.id));
        if (candidates.length !== 1) throw new ProbeFailure('V2_TEACHING_SLOT_REQUIRED');
        armV2Operation({ operationId: candidates[0].id, kind: 'teaching', requestKind: 'teaching-send', stageId: scope.stageId, entityRole: role,
          ...(entity ? { entityId: entity } : {}), expectedFields: { selector: scope.selector, threadId: scope.threadId,
            skillId: scope.skillId, skillVersionId: scope.skillVersionId, knownMessages: scope.knownMessages } });
        ticketCandidates = [tickets.get(candidates[0].id)];
      }
      if (ticketCandidates.length !== 1) throw new ProbeFailure('V2_TEACHING_SLOT_REQUIRED');
      const ticket = ticketCandidates[0], prefix = scope.prompt.split('\n')[0];
      const nativeCandidate = Object.hasOwn(V2_NATIVE_ACTION_STAGES, prefix);
      const coordinates = threadCoordinates.get(scope.threadId), pins = threadPins.get(scope.threadId) ?? [];
      const finding = scope.interviewFinding === true;
      const guideKey = `interview:${scope.selector.entityId}`;
      const previousProblem = teachingLedger.get(1);
      const revising = scope.stageId === 1 && scope.problemRevision === true;
      if (revising && (!previousProblem?.completed || previousProblem.scope.threadId !== scope.threadId
        || previousProblem.scope.selector.entityId !== scope.selector.entityId || previousProblem.scope.prompt === scope.prompt)) throw new ProbeFailure('TEACHING_PROBLEM_REVISION_NOT_VERIFIED');
      const synthetic = scope.syntheticProblemFixture === true;
      if (synthetic && (scope.stageId !== 1 || revising || !isolatedProblemReceipt || !scope.selector.entityId
        || isolatedProblemReceipt.threadId === scope.threadId || isolatedProblemReceipt.entityId === scope.selector.entityId)) throw new ProbeFailure('SYNTHETIC_PREREQUISITE_NOT_BOUND');
      const guideRevision = scope.interviewGuideRevision === true;
      const revisionKey = `revision:${scope.selector.entityId}`;
      if (guideRevision && (scope.stageId !== 2 || finding || !teachingLedger.get(guideKey)?.completed
        || teachingLedger.get(guideKey).scope.threadId !== scope.threadId || teachingLedger.get(guideKey).scope.prompt === scope.prompt)) throw new ProbeFailure('TEACHING_GUIDE_REVISION_NOT_VERIFIED');
      let definitionKind;
      if (scope.stageId === 3 && scope.selector.entityId) {
        const id = scope.selector.entityId, fields = stageStates.get(3)?.content?.draft?.fields ?? {};
        if (id === 'primary-surprise' && fields.definitionPrimaryEntity === 'true') definitionKind = 'surprise';
        for (const [prefix, kind] of [['definitionPersona:', 'persona'], ['definitionHmw:', 'hmw']]) {
          const raw = fields[prefix + id];
          if (typeof raw !== 'string') continue;
          let record;
          try { record = JSON.parse(raw); } catch { throw new ProbeFailure('TEACHING_DEFINITION_ENTITY_UNVERIFIED'); }
          if (record.id === id && !record.archived) definitionKind = kind;
        }
        if (definitionKind === 'hmw') {
          const earlier = [...teachingLedger.keys()].filter(key => typeof key === 'string' && key.startsWith('definition:hmw:'));
          if (earlier.length >= 2) throw new ProbeFailure('TEACHING_DEFINITION_ENTITY_UNVERIFIED');
          definitionKind += ':' + id;
        }
        if (!definitionKind) throw new ProbeFailure('TEACHING_DEFINITION_ENTITY_UNVERIFIED');
      }
      const summary = scope.selector.purpose === 'summary';
      let testMethod;
      if (scope.stageId === 6 && !summary && scope.selector.entityId) {
        let group;
        try { group = JSON.parse(stageStates.get(6)?.content?.draft?.fields['testGroup:' + scope.selector.entityId]); } catch { /* Not a saved test group. */ }
        if (group?.id !== scope.selector.entityId || group.archived || !['interview', 'survey'].includes(group.method)) throw new ProbeFailure('TEACHING_TEST_ENTITY_UNVERIFIED');
        testMethod = group.method;
      }
      const brainstorming = scope.stageId === 4 ? brainstormRecord(stageStates.get(4), scope.selector.entityId) : null;
      if (brainstorming && (!['free','reverse','scamper','analogy','role','brainwriting'].includes(brainstorming.method)
        || !Number.isInteger(brainstorming.count) || brainstorming.count < 1 || brainstorming.count > 24)) throw new ProbeFailure('TEACHING_BRAINSTORM_SCOPE_NOT_VERIFIED');
      if (scope.testPlan && (!testMethod || summary)) throw new ProbeFailure('TEACHING_TEST_ENTITY_UNVERIFIED');
      const key = nativeCandidate || scope.stageId >= 3 ? 'v2-operation:' + ticket.operationId
        : synthetic ? 'synthetic-problem' : revising ? 'problem-revision' : finding ? `finding:${scope.selector.entityId}` : guideRevision ? revisionKey : scope.stageId === 2 ? guideKey : scope.stageId;
      const interviews = [...teachingLedger.keys()].filter(id => typeof id === 'string' && id.startsWith('interview:'));
      if (scope.stageId === 2 && (!scope.selector.entityId || (!finding && !guideRevision && interviews.length >= 10))) throw new ProbeFailure('TEACHING_SCOPE_NOT_VERIFIED');
      if (finding) {
        let record;
        try { record = JSON.parse(stageStates.get(2)?.content.draft.fields[`interviewRecord:${scope.selector.entityId}`]); } catch { /* Missing or corrupt saved guide. */ }
        if (scope.stageId !== 2 || record?.id !== scope.selector.entityId || typeof record.code !== 'string' || !record.code.trim() || record.code.length > 80 || !record.guideConfirmed
          || teachingLedger.get(revisionKey)?.scope.threadId !== scope.threadId || !teachingLedger.get(revisionKey)?.completed) throw new ProbeFailure('TEACHING_FINDING_SCOPE_NOT_VERIFIED');
      }
      if (teachingStopped || !ordinaryVerified || scope.projectId !== projectId || scope.actorId !== actor || teachingLedger.has(key) || teachingRequests >= TEACHING_TURN_LIMIT
        || !coordinates || coordinates.purpose !== (summary ? 'report' : 'stage') || coordinates.stageId !== scope.stageId || coordinates.entityId !== (summary ? 'group-report' : scope.selector.entityId)
        || !threadFacts.get(scope.threadId)?.writable || !pins.some(pin => pin.skillId === scope.skillId && pin.versionId === scope.skillVersionId)
        || skillCatalog.get(scope.skillId)?.stableName !== identity.teachingSkillNames?.[summary ? 6 : scope.stageId - 1]
        || scope.selector.stageRevisions.some(ref => stageStates.get(ref.stageId)?.revision !== ref.revision)
        || JSON.stringify(scope.knownMessages) !== JSON.stringify(messageSnapshots.get(scope.threadId))) throw new ProbeFailure('TEACHING_SCOPE_NOT_VERIFIED');
      arm = null;
      teachingLedger.set(key, { scope, ticket, wire: null, accepted: null, until: now() + 15000, ...(brainstorming ? { brainstormUntil: now() + 180000 } : {}), ...(scope.testPlan ? { planUntil: now() + 180000 } : {}) });
    },

    armSurvey(entityId) {
      let record;
      try { record = JSON.parse(stageStates.get(6)?.content?.draft?.fields?.['testGroup:' + entityId]); } catch {}
      if (!ordinaryVerified || !projectId || !ownedDesigns.has(record?.designId) || record.method !== 'survey' || !record.versionId || !record.planFromMessageId) throw new ProbeFailure('SURVEY_TEST_ENTITY_REQUIRED');
      survey.arm(entityId);
    },
    surveyReceipt: survey.receipt,
    surveyPublication: survey.publication,
    decideSurveyParticipant({ url, method, body }) {
      if (case01 && ['POST','PUT','PATCH','DELETE'].includes(method) && case01PhysicalWrites >= CASE01_LIMITS.physicalWrites) return stop('WRITE_COUNT_BOUND');
      if (fatal) return { allow: false, kind: 'stopped', code: fatal };
      const target = new URL(url), publicLink = survey.publicLink();
      if (target.origin !== ORIGIN || target.username || target.password || target.hash
        || target.search || /%2e|%2f|%5c|\\/i.test(url.split('?')[0]) || !publicLink) return { allow: false };
      if (method === 'GET' && target.pathname === '/api/public' + publicLink) return survey.decide(method,target,undefined,projectId,'survey-participant');
      if (method === 'GET' && (target.pathname === publicLink || target.pathname.startsWith('/_next/static/') || target.pathname === '/favicon.ico')) return { allow: true, kind: 'read' };
      if (method === 'POST' && target.pathname === '/api/public' + publicLink + '/responses'
        && allowedWrites - reconcileCount < WRITE_LIMIT && Buffer.byteLength(JSON.stringify(body ?? null), 'utf8') <= MAX_BODY) {
        let ticket;
        try { ticket = claimRequest({url,method,body}); decidingTicket = ticket;
          const decision = survey.decide(method, target, body, projectId, 'survey-participant');
          if (decision?.allow) { allowedWrites++; if(case01)case01PhysicalWrites++; ticket.state = 'SENT'; ticket.ledger.markOperationSent(ticket.operationId,ticket.scope); requestTickets.set(decision,ticket); return decision; }
        } catch (error) { return stop(error.code ?? 'V2_SURVEY_PARTICIPANT_REJECTED'); }
        finally { decidingTicket = null; }
      }
      return { allow: false };
    },
    armDesignCreate: (value = {}) => { const name = value.name ?? [...tickets.values()].find(ticket => ticket.state === 'ARMED' && ticket.requestKind === 'design-create')?.expectedFields?.name;
      if (!projectId || !ordinaryVerified || typeof name !== 'string' || !name.trim() || name.length > 80 || !/QA|合成/u.test(name) || !name.includes(identity.run)) throw new ProbeFailure('DESIGN_CREATE_ARM_REJECTED'); designArm = { name, until: now() + 15000 }; },
    armDesignGeneration: (value = {}) => { const id = value.designId ?? designId; if (!ownedDesigns.has(id) || !linkedDesigns.has(id)) throw new ProbeFailure('DESIGN_GENERATION_ARM_REJECTED'); designId = id; modelArm = now() + 15000; },
    armDesignImage: ({ id, fileName, bytes }) => {
      let record;
      try { record = JSON.parse(stageStates.get(5)?.content.draft.fields[`prototypeEntity:${id}`]); } catch { /* No confirmed record. */ }
      if (!projectId || !ordinaryVerified || !ownedDesigns.has(id) || !linkedDesigns.has(id) || !resources.has(id) || imageArm
        || record?.verificationQuestionConfirmed !== 'true' || !record.verificationQuestion?.trim() || !record.prototypeIdeaSource
        || !new RegExp(`^qa-${identity.run}-[A-Za-z0-9_-]{1,80}\\.png$`).test(fileName) || !Buffer.isBuffer(bytes) || bytes.length < 10 || bytes.length > 16_384
        || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new ProbeFailure('DESIGN_IMAGE_ARM_REJECTED');
      const source = 'data:image/png;base64,' + bytes.toString('base64');
      designId = id;
      imageArm = { name: fileName, source, summary: 'AIDT 图片原型 · ' + createHash('sha256').update(source).digest('hex'), until: now() + 15000 };
    },
    registerFixture: ({ filename, bytes, mime }) => {
      if (!projectId || !Buffer.isBuffer(bytes) || bytes.length < 10 || bytes.length > 262144 || !filename.startsWith(`qa-${identity.run}-`) || !/^[A-Za-z0-9_.-]{1,180}$/.test(filename) || !['text/plain', 'image/png', 'audio/wav', 'audio/x-wav', 'audio/mpeg'].includes(mime)) throw new ProbeFailure('FIXTURE_REJECTED');
      const fixture = { filename, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mime };
      if (fixtures.has(filename)) throw new ProbeFailure('FIXTURE_REUSED'); fixtures.set(filename, fixture); uploadArm = { ...fixture, until: now() + 30000 }; return fixture;
    },
    observeContent: (decision, status, headers, bytes) => {
      if (decision.kind === 'case01-stage-file-content') { stageFiles.content(decision, status, bytes); return; }
      if (decision.kind === 'v2-native-audio-content') {
        const original = nativeAudio.get(decision.attachmentId);
        if (status !== 200 || !original || bytes.length !== original.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== original.sha256) throw new ProbeFailure('V2_NATIVE_AUDIO_CONTENT_UNVERIFIED');
        return;
      }
      if (decision.kind === 'v2-native-artifact-content') {
        const version = publishedArtifacts.get(decision.artifactKey);
        if (status !== 200 || !version || bytes.length !== version.sizeBytes || !ownedRuns.has(version.producedByRunId)) throw new ProbeFailure('V2_NATIVE_ARTIFACT_CONTENT_UNVERIFIED');
        return;
      }
      const uploaded = uploads.get(decision.runId), version = headers['x-artifact-version-id'];
      if (status !== 200 || !uploaded || bytes.length !== uploaded.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== uploaded.sha256 || headers['x-content-sha256'] !== uploaded.sha256 || headers['x-artifact-id'] !== uploaded.artifactId || !/^[A-Za-z0-9_-]{1,256}$/.test(version ?? '')) throw new ProbeFailure('UPLOAD_CONTENT_UNVERIFIED');
      resources.add(version);
      verifiedUploadContents.set(decision.runId,{...uploaded,versionId:version,at:now()});
    },
    armLogin: () => { loginArmed = true; },
    readIdentityRole: (status, identityResponse) => {
      if (!actor || status !== 200 || identityResponse?.org?.id !== org || !['consultant', 'lead', 'admin', 'compliance'].includes(identityResponse.orgRole)) throw new ProbeFailure('IDENTITY_ROLE_UNVERIFIED');
      return { orgRole: identityResponse.orgRole, organizationMatched: true, ordinaryConsultant: identityResponse.orgRole === 'consultant' };
    },
    verifyOrdinaryIdentity: (status, identityResponse) => {
      if (!actor || status !== 200 || identityResponse?.org?.id !== org || identityResponse.orgRole !== 'consultant') throw new ProbeFailure('ORDINARY_QA_CONSULTANT_REQUIRED');
      ordinaryVerified = true;
      return { orgRole: 'consultant', organizationMatched: true, administrator: false, lead: false };
    },
    armProjectCreate: (courseTag) => { if (courseTag !== undefined && courseTag !== `QA课程 ${identity.run}-${identity.attempt}`) throw new ProbeFailure('PROJECT_CREATE_COURSE_TAG_REJECTED'); if (identity.entryDiagnosticOnly || !ordinaryVerified || candidate || projectId || createCount) throw new ProbeFailure('PROJECT_CREATE_ARM_REJECTED'); projectCreateUntil = now() + 15000; projectCourseTag = courseTag; },
    armStageSave: (stage, confirmation = false) => { if (!projectId || !Number.isInteger(stage) || stage < 1 || stage > 6) throw new ProbeFailure('CONFIRMATION_ARM_REJECTED'); arm = { stage, confirmation, remaining: 2, until: now() + 15000 }; },
    bindOwnedProject: (overview, members) => {
      if (!candidate || projectId || overview?.projectId !== candidate || overview.name !== identity.projectName || !Array.isArray(members) || !members.some(item => item.userId === actor && item.role === 'owner')) throw new ProbeFailure('PROJECT_OWNERSHIP_UNVERIFIED');
      projectId = candidate;
    },
    identity: () => ({ actor, org, candidate, projectId, ordinaryVerified }),
    summary: () => ({ readCategories: { ...readCategories }, readDenials: { ...readDenials }, metadataHttpStatuses: { items: metadataHttpStatuses.map(item => ({ ...item })), truncated: metadataHttpStatusesTruncated }, ordinaryRoleVerified: ordinaryVerified, profile: plan.profile, ...(case01 ? { physicalBusinessWrites:case01PhysicalWrites,physicalBusinessWritesAllowed:CASE01_LIMITS.physicalWrites,loginCountedSeparately:true } : {}), teachingRequestsAllowed: TEACHING_TURN_LIMIT, teachingRequests, teachingStopped, ownedTeachingRunCount: ownedRuns.size, suggestionsBlocked, loginRequests: loginCount, projectCreates: createCount, allowedWrites, reconcileCount, modelRequestsAllowed: plan.limits.design, modelRequests: modelCount, designRequestedScreens: modelRequestedScreens, designModel: modelReceipt, roleWritesAllowed: 0, deletesAllowed: 0, projectId, ownedDesignIds: [...ownedDesigns], ownedResearchIds: [...researchSources.keys()], ownedThreadCount: threads.size, ownedUploadCount: uploads.size,
      operations: [...tickets.values()].map(ticket => ({ operationId: ticket.operationId, requestKind: ticket.requestKind, state: ticket.state, requestSha256: ticket.requestSha256 })) }),
  };
}

export function assertScreenshotSafe(text, secrets) {
  if (secrets.some(secret => typeof secret === 'string' && secret.length > 0 && text.includes(secret))) throw new ProbeFailure('SCREENSHOT_SENSITIVE_CONTENT');
}

export function assertCaptureScope(rawUrl, ownedProjectId, expectedStage) {
  let url; try { url = new URL(rawUrl); } catch { throw new ProbeFailure('SCREENSHOT_SCOPE_REJECTED'); }
  if (!PROJECT.test(ownedProjectId ?? '') || url.origin !== ORIGIN || url.username || url.password || url.pathname !== `/aidt/${ownedProjectId}` || (expectedStage !== undefined && (!Number.isInteger(expectedStage) || expectedStage < 1 || expectedStage > 6 || url.searchParams.get('step') !== String(expectedStage)))) throw new ProbeFailure('SCREENSHOT_SCOPE_REJECTED');
}
