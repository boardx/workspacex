/** Live Dev acceptance: this is a bounded test-data writer, not the read-only probe. */
import { ORIGIN, ProbeFailure, validLoginBody } from './devapp-aidt-auth-readonly.mjs';
import { createHash } from 'node:crypto';
import { validateTeachingScope, validateTeachingWire, identifyOwnedTeachingRun, brainstormRecord, validBrainstormProjection, validTestPlanProjection, ENTITY } from './devapp-aidt-chat-evidence.mjs';

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
function checkReferences(value, projectId, threads, resources, depth = 0) {
  if (depth > 20) throw new ProbeFailure('BODY_NESTING_BOUND');
  if (typeof value === 'string' && /^[\[{]/.test(value.trim()) && value.length <= MAX_BODY) {
    try { checkReferences(JSON.parse(value), projectId, threads, resources, depth + 1); } catch (error) { if (error instanceof ProbeFailure) throw error; }
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (['projectId', 'sourceProjectId', 'teachingProjectId'].includes(key) && entry !== null && entry !== '' && entry !== projectId) throw new ProbeFailure('FOREIGN_PROJECT_REFERENCE');
      if (key === 'threadId' && entry !== null && entry !== '' && !threads.has(entry)) throw new ProbeFailure('FOREIGN_THREAD_REFERENCE');
      if (/^(artifactId|versionId|prototypeVersionId|prototypeDesignId|designId|designProjectId|surveyId|resourceId|fileId)$/.test(key) && entry && !resources.has(entry)) throw new ProbeFailure('FOREIGN_RESOURCE_REFERENCE');
      if (key === 'runId' && value.artifactId && entry && !resources.has(entry)) throw new ProbeFailure('FOREIGN_RESOURCE_REFERENCE');
      checkReferences(entry, projectId, threads, resources, depth + 1);
    }
  }
}

// Two S1 turns, one optional independent S1 fixture, thirty S2 turns, four later stages.
export const TEACHING_TURN_LIMIT = 44;
// Nine additional interviews each save a guide, consent, a transcript and the confirmed finding.
const WRITE_LIMIT = 128 + 9 * 15;

const SurveyId = new RegExp(`^${UUID}$`);
const SurveyToken = /^[A-Za-z0-9._-]{12,180}$/;
const surveyTypes = ['short','date','scale','scale','scale','single','scale','open'];
const surveyTitles = ['会议名称','会议日期','会议目标和议程清晰。','会议内容与我的工作相关。','参会者有足够机会表达意见。','会议时长是否合适？','会后行动项、负责人和时间明确。','下次会议最值得改进的地方是什么？'];
const surveyQuestions = surveyTypes.map((_, i) => `meeting-feedback-q${i + 1}`);
export function aidtSurveyFixture(run, attempt) {
  const marker = `QA-${run}-${attempt}`;
  return { title: `${marker} 合成原型反馈问卷`, name: `${marker} 合成原型观察`, answer: `${marker} 只验证原型标签是否可读，未观察到真实购买或耗时。` };
}
function validSurveyDraft(body, fixture) {
  return object(body) && Object.keys(body).sort().join(',') === 'questions,tags,template,title'
    && body.title === fixture.title && Array.isArray(body.tags) && body.tags.length === 0
    && body.template?.id === 'meeting-feedback-report'
    && Array.isArray(body.questions) && body.questions.length === surveyTypes.length
    && body.questions.every((question, i) => question?.id === surveyQuestions[i] && question.type === surveyTypes[i] && question.title === surveyTitles[i]
       && question.provenance?.source === 'template' && question.provenance.sourceId === 'builtin-survey-meeting-feedback');
}
function validSurveySubmission(body, fixture) {
  if (!object(body) || Object.keys(body).sort().join(',') !== 'answers,durationSeconds,submissionId'
      || !SurveyId.test(body.submissionId ?? '') || !Number.isSafeInteger(body.durationSeconds) || body.durationSeconds < 0 || body.durationSeconds > 180
      || !Array.isArray(body.answers) || body.answers.length !== surveyQuestions.length
      || body.answers.some(answer => !object(answer) || Object.keys(answer).sort().join(',') !== 'questionId,value')) return false;
  const answers = new Map(body.answers.map(({questionId, value}) => [questionId, value]));
  return answers.size === surveyQuestions.length && answers.get(surveyQuestions[0]) === fixture.name
    && answers.get(surveyQuestions[1]) === '2026-11-21'
    && [2,3,4,6].every(index => answers.get(surveyQuestions[index]) === '4')
    && ['o2', '合适'].includes(answers.get(surveyQuestions[5])) && answers.get(surveyQuestions[7]) === fixture.answer;
}

export function createAcceptanceGuard(identity, now = Date.now) {
  let actor = null, org = null, candidate = null, projectId = null, loginArmed = false, fatal = null;
  let loginCount = 0, createCount = 0, arm = null, allowedWrites = 0, ordinaryVerified = false, projectCreateUntil = null, projectCourseTag;
  const threadCoordinates = new Map(), threadFacts = new Map(), threadPins = new Map(), messageSnapshots = new Map(), stageStates = new Map(), skillCatalog = new Map(), teachingLedger = new Map(), ownedRuns = new Set();
  let reconcileCount = 0;
  let teachingRequests = 0, suggestionsBlocked = 0, teachingStopped = false, isolatedProblemReceipt = null;
  const threads = new Set(), resources = new Set(), uploads = new Map(), fixtures = new Map(), snapshots = new Map(), teachingSkills = new Set();
  let imageArm = null, imageCount = 0, designLinked = false;
  const surveyFixture = aidtSurveyFixture(identity.run, identity.attempt);
  let surveyArm = null, survey = null, surveyCreateSent = false, surveyLinkSent = false, surveyPublishSent = false, surveySubmitSent = false;
  let testSaveArm = null;
  function testRecord(stage, entityId) {
    try {
      const record = JSON.parse(stage?.content?.draft?.fields?.['testGroup:' + entityId]);
      return record.id === entityId && !record.archived ? record : null;
    } catch { return null; }
  }
  function guardedTestSave(body) {
    const beforeStage = stageStates.get(6), before = beforeStage?.content?.draft, after = body?.content?.draft;
    const bound = testSaveArm, key = 'testGroup:' + bound?.entityId;
    if (!bound || now() > bound.until || !before || !after || body.expectedRevision !== beforeStage.revision
      || Object.keys(body).sort().join(',') !== 'content,expectedRevision,operationId,projectId,sourceStageRevisions,stageId'
      || body.projectId !== projectId || body.stageId !== 6 || !SurveyId.test(body.operationId ?? '')
      || JSON.stringify(body.sourceStageRevisions) !== JSON.stringify(beforeStage.sourceStageRevisions)
      || JSON.stringify({ ...beforeStage.content, draft: undefined }) !== JSON.stringify({ ...body.content, draft: undefined })) return false;
    if (JSON.stringify({ ...before, fields: undefined }) !== JSON.stringify({ ...after, fields: undefined })) return false;
    const beforeFields = { ...before.fields }, afterFields = { ...after.fields };
    delete beforeFields[key]; delete afterFields[key];
    if (afterFields.reflectionConfirmed === '') afterFields.reflectionConfirmed = beforeFields.reflectionConfirmed;
    if (Object.keys({ ...beforeFields, ...afterFields }).some(field => beforeFields[field] !== afterFields[field])) return false;
    const original = testRecord(beforeStage, bound.entityId), next = testRecord({ content: body.content }, bound.entityId);
    if (!original || !next) return false;
    const fields = bound.action === 'method' ? ['method','source','material','sourceLocation','said','did','audioConsentAt','surveyResponseId','afterTestBelief','understandingChange']
      : bound.action === 'survey' || bound.action === 'response' ? ['source','sourceLocation','surveyResponseId','said','did','afterTestBelief','understandingChange'] : ['material'];
    if (Object.keys({ ...original, ...next }).some(field => !fields.includes(field) && JSON.stringify(next[field]) !== JSON.stringify(original[field]))) return false;
    if (bound.action === 'method') return original.method === 'interview' && next.method === 'survey' && next.source === null && next.material === null
      && !next.audioConsentAt && !next.surveyResponseId && !next.sourceLocation && !next.said && !next.did && !next.afterTestBelief && !next.understandingChange;
    if (bound.action === 'survey') return survey?.linked && bound.entityId === survey.entityId && next.method === 'survey' && next.source?.kind === 'survey'
      && Object.keys(next.source).sort().join(',') === 'id,kind' && next.source.id === survey.id
      && !next.surveyResponseId && !next.sourceLocation && !next.said && !next.did && !next.afterTestBelief && !next.understandingChange;
    if (bound.action === 'response') return survey?.responseId && bound.entityId === survey.entityId && next.source?.kind === 'survey'
      && Object.keys(next.source).sort().join(',') === 'id,kind' && original.source?.id === survey.id && next.source.id === survey.id
      && next.surveyResponseId === survey.responseId && next.sourceLocation === `答卷 ${survey.responseId}` && !next.said && !next.did && !next.afterTestBelief && !next.understandingChange;
    const upload = uploads.get(next.material?.runId);
    return original.method === 'interview' && upload?.filename === bound.filename && upload.artifactId === next.material.artifactId;
  }
  let uploadArm = null, designArm = null, designId = null, modelArm = null, modelCount = 0, modelReceipt = null, modelRequestedScreens = null;
  const readCategories = { nativeAgentCatalog: 0, runtimeMetadata: 0, other: 0 };
  const readDenials = { nativeAgentCatalog: 0, runtimeMetadata: 0, other: 0 };
  const metadataHttpStatuses = [];
  let metadataHttpStatusesTruncated = false;
  const stop = code => { fatal ??= code; return { allow: false, kind: 'rejected', code }; };
  function decideRequest({ url, method, resourceType, body, audience }) {
    if (fatal) return { allow: false, kind: 'stopped', code: fatal };
    if (/%2f|%5c|%2e|\\/i.test(url.split('?')[0])) return stop('TARGET_REJECTED');
    let target;
    try { target = new URL(url); } catch { return stop('TARGET_REJECTED'); }
    if (target.origin !== ORIGIN || target.username || target.password || target.hash || /%2f|%5c|%2e|\\/i.test(target.pathname)) return stop('TARGET_REJECTED');
    if (new Set(target.searchParams.keys()).size !== [...target.searchParams.keys()].length) return stop('DUPLICATE_QUERY_REJECTED');
    const path = target.pathname;
    if (body !== undefined && Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY) return stop('REQUEST_BODY_BOUND');
    if (projectId && target.searchParams.has('projectId') && target.searchParams.get('projectId') !== projectId) return stop('FOREIGN_PROJECT_REFERENCE');
    if (allowedWrites - reconcileCount >= WRITE_LIMIT && method !== 'GET') return stop('WRITE_COUNT_BOUND');
    if (audience === 'survey-participant') {
      if (!survey?.token || !ordinaryVerified || !survey.linked || target.search) return stop('SURVEY_PARTICIPANT_SCOPE_REJECTED');
      if (method === 'GET' && (path === `/surveys/${survey.token}` || path === `/api/public/surveys/${survey.token}`
          || path.startsWith('/_next/static/') || path === '/favicon.ico')) return { allow: true, kind: 'read' };
      if (method === 'POST' && path === `/api/public/surveys/${survey.token}/responses` && !surveySubmitSent
        && validSurveySubmission(body, surveyFixture)) {
        surveySubmitSent = true; allowedWrites++; return { allow: true, kind: 'survey-respond' };
      }
      if (method === 'GET') return { allow: false, kind: 'out-of-scope-read', code: 'READ_OUT_OF_SCOPE' };
      return stop('SURVEY_PARTICIPANT_SCOPE_REJECTED');
    }
    if (method === 'POST' && path === '/api/auth/login' && !target.search) {
      if (!loginArmed || actor || loginCount !== 0 || !object(body) || Object.keys(body).sort().join(',') !== 'email,password' || !body.email || !body.password) return stop('LOGIN_REJECTED');
      loginCount++; return { allow: true, kind: 'login' };
    }
    if (!actor && method !== 'GET') return stop('AUTHENTICATION_REQUIRED');
    if (identity.entryDiagnosticOnly && method !== 'GET') return stop('ENTRY_DIAGNOSTIC_READONLY');
    if (method === 'POST' && (path === '/api/copilotkit/agent/default/suggest' || path === '/api/copilotkit/agent/default/run' && body?.forwardedProps?.toolChoice?.function?.name === 'copilotkitSuggest')) { suggestionsBlocked++; return { allow: false, kind: 'optional-suggestion-blocked', code: 'OPTIONAL_SUGGESTION_NOT_EXERCISED' }; }
    if (method === 'GET') {
      // Native AgentOptions reads only this organization's agent catalog. This
      // does not authorize capability mutations or requests before QA ownership.
      if (path === '/api/capabilities' && ordinaryVerified && projectId
        && [...target.searchParams.keys()].sort().join(',') === 'kind,orgId'
        && target.searchParams.get('orgId') === org && target.searchParams.get('kind') === 'agent') {
        return { allow: true, kind: 'native-agent-catalog' };
      }
      if (ordinaryVerified && projectId && surveyArm && now() <= surveyArm.until && path === '/studio/survey'
          && [...target.searchParams.keys()].sort().join(',') === 'create,projectId' && target.searchParams.get('create') === '1') return { allow: true, kind: 'read' };
      if (survey?.linked && target.searchParams.get('projectId') === projectId
        && [...target.searchParams.keys()].every(key => key === 'projectId' || key === '_rsc')
        && ['design','publish','responses'].some(step => path === `/studio/survey/${survey.id}/${step}`)) return { allow: true, kind: 'read' };
      if (survey?.linked && path === `/api/surveys/${survey.id}` && !target.search) return { allow: true, kind: 'survey-read' };
      const publicPage = path === '/login' || path === '/aidt' || path === '/favicon.ico' || path.startsWith('/_next/static/') || approvedHomeImage(target);
      const accountRead = actor && (path === '/api/identity/me' || path === '/api/aidt/courses' || (path === '/api/copilotkit/info' && !target.search) || (path === '/api/projects' && target.searchParams.get('orgId') === org) || (path === '/api/skills' && target.searchParams.get('orgId') === org && [...target.searchParams.keys()].every(key => ['orgId', 'entry'].includes(key))));
      const ownedRead = (projectId || candidate) && (path === `/aidt/${projectId ?? candidate}` || path.startsWith(`/api/projects/${projectId ?? candidate}/`));
      for (const id of threads) {
        if (path === `/api/chat/threads/${encodeURIComponent(id)}`) return { allow: true, kind: 'thread-detail', threadId: id };
        if (path === `/api/chat/threads/${encodeURIComponent(id)}/messages`) return { allow: true, kind: 'thread-messages', threadId: id };
        if (path === `/api/threads/${encodeURIComponent(id)}/skill-deviations`) return { allow: true, kind: 'thread-pins', threadId: id };
      }
      const runRead = /^\/api\/agent-runs\/([A-Za-z0-9_.:-]+)(?:\/aidt-context)?$/.exec(path);
      if (runRead && !target.search) return ownedRuns.has(runRead[1]) ? { allow: true, kind: 'owned-teaching-run-read', runId: runRead[1] } : { allow: false, kind: 'teaching-run-needs-binding', runId: runRead[1] };
      const ownedChat = [...threads].some(id => path === `/api/chat/threads/${encodeURIComponent(id)}` || path.startsWith(`/api/chat/threads/${encodeURIComponent(id)}/`)
        || path === `/api/threads/${encodeURIComponent(id)}/skill-mounts` || path === `/api/threads/${encodeURIComponent(id)}/skill-deviations`);
      const projectChatList = projectId && path === '/api/chat/threads' && target.searchParams.get('projectId') === projectId;
      // Only metadata for a freshly generated, deliberately nonexistent ID is read for the denial check.
      const deniedProbe = identity.deniedProject && path === `/api/projects/${identity.deniedProject}/overview`;
      if (deniedProbe) return { allow: true, kind: 'denied-probe' };
      if (projectId && path === '/api/pm-designs' && !target.search) return { allow: true, kind: 'design-list' };
      const versions = designId && new RegExp(`^/api/pm-designs/${designId}/versions(?:/([^/]+))?$`).exec(path);
      if (versions && (!versions[1] || resources.has(versions[1])) && !target.search) return { allow: true, kind: 'design-versions', designId };
      const uploadRead = /^\/api\/ingestion-runs\/([^/]+)(\/content)?$/.exec(path);
      if (uploadRead && uploads.has(uploadRead[1]) && target.searchParams.get('projectId') === projectId && [...target.searchParams.keys()].every(key => key === 'projectId')) return { allow: true, kind: uploadRead[2] ? 'upload-content' : 'read', runId: uploadRead[1] };
      if (publicPage || accountRead || ownedRead || ownedChat || projectChatList || deniedProbe) {
        const stage = new RegExp(`^/api/projects/${projectId ?? candidate}/aidt/stages/([1-6])$`).exec(path);
        return stage ? { allow: true, kind: 'get-stage', stageId: Number(stage[1]) } : { allow: true, kind: path === '/api/skills' ? 'skill-catalog' : 'read' };
      }
      // Optional shell requests must not expand the test into unrelated user resources.
      return { allow: false, kind: 'out-of-scope-read', code: resourceType === 'document' ? 'NAVIGATION_REJECTED' : 'READ_OUT_OF_SCOPE' };
    }
    if (method === 'DELETE' || !['POST', 'PUT', 'PATCH'].includes(method) || /\/(?:members|collaborators|roles|permissions|courses|admin|config|policies|archive|restore)(?:\/|$)/.test(path)) return stop('FORBIDDEN_MUTATION');
    if (method === 'POST' && path === '/api/projects' && !projectId && !candidate) {
      if (!ordinaryVerified || !projectCreateUntil || now() > projectCreateUntil || createCount !== 0 || !object(body) || Object.keys(body).sort().join(',') !== (projectCourseTag === undefined ? 'blueprintVersionId,kind,name,orgId,profile' : 'blueprintVersionId,courseTag,kind,name,orgId,profile') || body.courseTag !== projectCourseTag || body.orgId !== org || body.kind !== 'general' || body.blueprintVersionId !== null || body.profile !== 'aidt' || body.name !== identity.projectName) return stop('PROJECT_CREATE_REJECTED');
      projectCreateUntil = null; createCount++; allowedWrites++; return { allow: true, kind: 'create-project' };
    }
    if (!projectId) return stop('OWNED_PROJECT_REQUIRED');
    if (method === 'POST' && path === '/api/copilotkit/agent/default/run') {
      const entries = [...teachingLedger.values()].filter(entry => entry.wire === null && entry.until >= now());
      if (teachingStopped || teachingRequests >= TEACHING_TURN_LIMIT || entries.length !== 1) return stop('TEACHING_SEND_NOT_ARMED');
      const entry = entries[0];
      try { entry.wire = validateTeachingWire({ url, method, body }, entry.scope); } catch (error) { return stop(error.code ?? 'TEACHING_WIRE_REJECTED'); }
      teachingRequests++; return { allow: true, kind: 'teaching-turn', stageId: entry.scope.stageId, threadId: entry.scope.threadId };
    }

    if (method === 'POST' && path === '/api/surveys' && !target.search && ordinaryVerified && surveyArm && now() <= surveyArm.until
      && !surveyCreateSent && validSurveyDraft(body, surveyFixture)) {
      surveyCreateSent = true; allowedWrites++; return { allow: true, kind: 'survey-create' };
    }
    if (method === 'POST' && survey && !surveyLinkSent && path === `/api/projects/${projectId}/resources` && !target.search
      && object(body) && Object.keys(body).sort().join(',') === 'kind,projectId,resourceId' && body.kind === 'survey'
      && body.projectId === projectId && body.resourceId === survey.id) {
      surveyLinkSent = true; allowedWrites++; return { allow: true, kind: 'survey-link' };
    }
    if (method === 'POST' && survey?.linked && !surveyPublishSent && survey.publishUntil >= now() && !target.search
      && path === `/api/surveys/${survey.id}/publish` && object(body) && Object.keys(body).join(',') === 'expectedVersion' && body.expectedVersion === survey.version) {
      surveyPublishSent = true; allowedWrites++; return { allow: true, kind: 'survey-publish' };
    }
    try { checkReferences(body, projectId, threads, resources); } catch (error) { return stop(error.code ?? 'REFERENCE_REJECTED'); }
    if (method === 'POST' && path === '/api/pm-designs' && !target.search && !designId && designArm && now() <= designArm && object(body) && Object.keys(body).sort().join(',') === 'name,template' && body.name === '未命名设计' && body.template === 'ui') {
      designArm = null; allowedWrites++; return { allow: true, kind: 'create-design' };
    }
    if (method === 'POST' && path === `/api/projects/${projectId}/resources` && object(body) && Object.keys(body).sort().join(',') === 'kind,projectId,resourceId' && body.projectId === projectId && body.kind === 'design' && designId && body.resourceId === designId) {
      allowedWrites++; return { allow: true, kind: 'link-design' };
    }
    if (method === 'POST' && designId && path === `/api/pm-designs/${designId}/chat` && !target.search) {
      if (!modelArm || now() > modelArm || modelCount !== 0 || !object(body) || Object.keys(body).some(key => !['text', 'maxScreens'].includes(key)) || typeof body.text !== 'string' || !body.text.includes('QA') || !body.text.includes(identity.run) || body.text.length > 4000 || (body.maxScreens !== undefined && body.maxScreens !== 1)) return stop('DESIGN_GENERATION_NOT_ARMED');
      // The normal first-send UI omits maxScreens. Root approved that one request
      // with the service's default page count; no request body is rewritten here.
      modelRequestedScreens = body.maxScreens ?? 'service-default';
      modelCount++; modelArm = null; allowedWrites++; return { allow: true, kind: 'design-generation', designId };
    }
    if (method === 'POST' && designId && path === `/api/pm-designs/${designId}/prototype/patch`) {
      const op = body?.ops?.[0], root = op?.root, props = root?.props;
      if (target.search || !imageArm || imageCount || now() > imageArm.until || !object(body) || Object.keys(body).sort().join(',') !== 'ops,summary'
        || !Array.isArray(body.ops) || body.ops.length !== 1 || !object(op) || Object.keys(op).sort().join(',') !== 'at,frame,op,root'
        || op.op !== 'addScreen' || op.at !== 0 || op.frame !== '图片原型' || !object(root) || Object.keys(root).sort().join(',') !== 'props,type'
        || root.type !== 'image' || !object(props) || Object.keys(props).sort().join(',') !== 'alt,src'
        || props.alt !== imageArm.name || props.src !== imageArm.source || body.summary !== imageArm.summary) return stop('DESIGN_IMAGE_NOT_ARMED');
      imageCount++; imageArm = null; allowedWrites++;
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
      if (n === 6 && testSaveArm) {
        if (target.search || !guardedTestSave(body)) return stop('TEST_AUTOSAVE_SCOPE_REJECTED');
        testSaveArm = null; allowedWrites++; return { allow: true, kind: 'save-stage', stageId: n };
      }
      const explicitlyArmed = arm && arm.stage === n && arm.remaining > 0 && now() <= arm.until;
      const projection = [...teachingLedger.values()].find(entry => entry.wire && !entry.projected && (
        n === 4 && entry.brainstormUntil >= now() && validBrainstormProjection(stageStates.get(4), body, entry.scope.selector.entityId) ||
        n === 6 && entry.planUntil >= now() && validTestPlanProjection(stageStates.get(6), body, entry.scope.selector.entityId)));
      if (!explicitlyArmed && !projection) return stop('STAGE_SAVE_NOT_ARMED');
      const before = snapshots.get(n) ?? new Set();
      let next;
      try { next = confirmations(body.content); } catch (error) { return stop(error.code ?? 'CONFIRMATION_REJECTED'); }
      const changes = [...next].some(entry => !before.has(entry));
      if (changes && (!explicitlyArmed || !arm.confirmation)) return stop('CONFIRMATION_NOT_ARMED');
      if (projection) projection.projected = true;
      else arm.remaining--;
      if (Object.keys(body.content.draft).some(key => !ROOTS.has(key))) return stop('DRAFT_SCHEMA_REJECTED');
      allowedWrites++; return { allow: true, kind: 'save-stage', stageId: n };
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
      allowedWrites++; return { allow: true, kind: 'create-thread' };
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
    const decision = decideRequest(request);
    if (request.method === 'GET') {
      let path; try { path = new URL(request.url).pathname; } catch { /* Classify invalid targets without retaining request data. */ }
      const category = path === '/api/capabilities' ? 'nativeAgentCatalog' : ['/api/copilotkit', '/api/copilotkit/info'].includes(path) ? 'runtimeMetadata' : 'other';
      (decision.allow ? readCategories : readDenials)[category]++;
      return { ...decision, readCategory: category };
    }
    return decision;
  }
  function observe(decision, status, response) {
    if (decision.allow && ['nativeAgentCatalog', 'runtimeMetadata'].includes(decision.readCategory) && Number.isInteger(status) && status >= 100 && status <= 599) {
      if (metadataHttpStatuses.length < 128) metadataHttpStatuses.push({ category: decision.readCategory, status });
      else metadataHttpStatusesTruncated = true;
    }
    if (status >= 300 && status < 400) throw new ProbeFailure('REDIRECT_REJECTED');
    if (decision.kind === 'login') {
      if (status !== 200 || !validLoginBody(response)) throw new ProbeFailure('AUTHENTICATION_FAILED');
      actor = response.userId; org = response.orgs[0];
    } else if (decision.kind === 'create-project') {
      if (![200, 201].includes(status) || !PROJECT.test(response?.id ?? '') || response.kind !== 'general' || response.status !== 'active') throw new ProbeFailure('PROJECT_RESPONSE_REJECTED');
      candidate = response.id;
    } else if (decision.kind === 'survey-create') {
      if (status !== 201 || !SurveyId.test(response?.id ?? '') || response.title !== surveyFixture.title || response.status !== 'draft'
        || !Number.isSafeInteger(response.version) || response.version < 1 || response.publication !== null || response.responses?.length !== 0)
        throw new ProbeFailure('NATIVE_SURVEY_CREATE_UNVERIFIED');
      survey = { id: response.id, version: response.version, entityId: surveyArm.entityId };
    } else if (decision.kind === 'survey-link') {
      if (![200,201,204].includes(status)) throw new ProbeFailure('NATIVE_SURVEY_LINK_UNVERIFIED');
      survey.linked = true;
    } else if (decision.kind === 'survey-publish') {
      const token = response?.publication?.token;
      if (status !== 201 || response.id !== survey.id || response.title !== surveyFixture.title || response.publication?.status !== 'collecting'
        || !SurveyToken.test(token ?? '') || response.responses?.length !== 0) throw new ProbeFailure('NATIVE_SURVEY_PUBLISH_UNVERIFIED');
      survey.token = token;
    } else if (decision.kind === 'survey-respond') {
      if (status !== 201 || !SurveyId.test(response?.responseId ?? '') || response.replayed !== false) throw new ProbeFailure('NATIVE_SURVEY_RESPONSE_UNVERIFIED');
      survey.responseId = response.responseId;
    } else if (decision.kind === 'survey-read') {
      if (status !== 200 || response?.id !== survey.id || response.title !== surveyFixture.title) throw new ProbeFailure('NATIVE_SURVEY_READ_UNVERIFIED');
      if (survey.responseId && (response.responses?.length !== 1 || response.responses[0].id !== survey.responseId
        || !response.responses[0].answers?.some(answer => answer.questionId === surveyQuestions[7] && answer.value === surveyFixture.answer)))
        throw new ProbeFailure('NATIVE_SURVEY_READ_UNVERIFIED');
    } else if (decision.kind === 'create-design') {
      const item = response?.project;
      if (![200, 201].includes(status) || !/^[A-Za-z0-9_-]{1,128}$/.test(item?.id ?? '') || item.ownerId !== actor || item.name !== '未命名设计' || item.template !== 'ui' || item.frames?.length !== 0 || item.share !== null) throw new ProbeFailure('DESIGN_OWNERSHIP_UNVERIFIED');
      designId = item.id; resources.add(designId);
    } else if (decision.kind === 'link-design' && [200, 201, 204].includes(status)) {
      designLinked = true;
    } else if (decision.kind === 'design-image' && status === 200) {
      if (response?.project?.id !== designId || response.project.ownerId !== actor || response.project.prototype?.[0]?.type !== 'image') throw new ProbeFailure('DESIGN_IMAGE_RESPONSE_REJECTED');
    } else if (decision.kind === 'design-versions' && status === 200) {
      for (const item of response?.items ?? []) { if (!/^[A-Za-z0-9_-]{1,256}$/.test(item.id ?? '')) throw new ProbeFailure('DESIGN_VERSION_UNVERIFIED'); resources.add(item.id); }
    } else if (decision.kind === 'design-generation') {
      modelReceipt = { attempted: true, httpStatus: status, replySource: ['model', 'fallback'].includes(response?.reply?.source) ? response.reply.source : 'unknown', generatedFrames: Array.isArray(response?.project?.frames) ? response.project.frames.length : 0 };
      if (status === 200 && (response?.project?.id !== designId || response.project.ownerId !== actor)) throw new ProbeFailure('DESIGN_OWNERSHIP_UNVERIFIED');
    } else if (decision.kind === 'upload') {
      const run = response?.runs?.[0];
      if (![200, 201, 202].includes(status) || response?.runs?.length !== 1 || run.duplicateHit || !/^[A-Za-z0-9_-]{1,256}$/.test(run.ingestionRunId ?? '') || !/^[A-Za-z0-9_-]{1,256}$/.test(run.artifactId ?? '') || resources.has(run.artifactId) || uploads.has(run.ingestionRunId)) throw new ProbeFailure('UPLOAD_RECEIPT_REJECTED');
      resources.add(run.artifactId); resources.add(run.ingestionRunId); uploads.set(run.ingestionRunId, { ...decision.fixture, artifactId: run.artifactId });
    } else if (decision.kind === 'entity-thread' || decision.kind === 'create-thread') {
      if (status === 200 || status === 201) {
        if (!/^(?:thr[-_])[a-zA-Z0-9_-]{1,180}$/.test(response?.threadId ?? '')) throw new ProbeFailure('THREAD_RESPONSE_REJECTED');
        threads.add(response.threadId);
        if (decision.kind === 'entity-thread') threadCoordinates.set(response.threadId, { stageId: decision.stageId, entityId: decision.entityId, purpose: decision.purpose });
      }
    } else if (decision.kind === 'skill-catalog' && status === 200 && Array.isArray(response?.items)) {
      for (const item of response.items) if (identity.teachingSkillNames?.includes(item.platformStableName) && item.status === '已启用' && typeof item.currentVersionId === 'string' && item.currentVersionId && typeof item.skillId === 'string') { teachingSkills.add(item.skillId); skillCatalog.set(item.skillId, { stableName: item.platformStableName, currentVersionId: item.currentVersionId }); }
    } else if (decision.kind === 'thread-detail' && status === 200) {
      if (response?.thread?.id !== decision.threadId || response.thread.projectId !== projectId) throw new ProbeFailure('TEACHING_THREAD_PROJECT_MISMATCH');
      threadFacts.set(decision.threadId, { writable: response.thread.archived === false && response.capabilities?.includes('composer.send') === true });
    } else if (decision.kind === 'thread-pins' && status === 200) {
      if (!Array.isArray(response?.temporary) || response.temporary.some(pin => pin.threadId !== decision.threadId)) throw new ProbeFailure('TEACHING_THREAD_PINS_INVALID');
      threadPins.set(decision.threadId, response.temporary.filter(pin => pin.removedAt === null));
    } else if (decision.kind === 'thread-messages' && status === 200) {
      const rows = Array.isArray(response) ? response : response?.messages;
      if (!Array.isArray(rows) || rows.length > 100 || !Array.isArray(response) && response.nextCursor != null) throw new ProbeFailure('TEACHING_MESSAGE_READ_INVALID');
      messageSnapshots.set(decision.threadId, rows);
      for (const entry of teachingLedger.values()) if (entry.wire && entry.scope.threadId === decision.threadId) {
        const accepted = identifyOwnedTeachingRun(response, entry.scope, entry.wire);
        if (accepted) { if (entry.accepted && entry.accepted.runId !== accepted.runId) throw new ProbeFailure('TEACHING_RUN_BINDING_CHANGED'); entry.accepted = accepted; ownedRuns.add(accepted.runId); }
      }
    } else if ((decision.kind === 'save-stage' || decision.kind === 'get-stage') && status === 200 && response?.stage) {
      if (response?.stage?.projectId !== projectId || response.stage.stageId !== decision.stageId) throw new ProbeFailure('STAGE_RESPONSE_REJECTED');
      snapshots.set(decision.stageId, confirmations(response.stage.content));
      stageStates.set(decision.stageId, response.stage);
    }
  }
  return { decide, observe, fail: stop, fatal: () => fatal,
    stopTeaching: () => { teachingStopped = true; },
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
      matches[0].completed = true;
    },
    armTeachingSend: scope => {
      validateTeachingScope(scope);
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
      if (brainstorming && (brainstorming.method === 'reverse' ? brainstorming.count !== 5
        : brainstorming.method === 'scamper' ? brainstorming.count !== 1 : true)) throw new ProbeFailure('TEACHING_BRAINSTORM_SCOPE_NOT_VERIFIED');
      if (scope.testPlan && (!testMethod || summary)) throw new ProbeFailure('TEACHING_TEST_ENTITY_UNVERIFIED');
      const key = scope.testPlan ? 'test-plan:' + testMethod : brainstorming ? 'brainstorm:' + brainstorming.method : summary ? 'group-report' : testMethod ? 'test:' + testMethod : synthetic ? 'synthetic-problem' : revising ? 'problem-revision' : finding ? `finding:${scope.selector.entityId}` : guideRevision ? revisionKey : scope.stageId === 2 ? guideKey : definitionKind ? 'definition:' + definitionKind : scope.stageId;
      const interviews = [...teachingLedger.keys()].filter(id => typeof id === 'string' && id.startsWith('interview:'));
      if (scope.stageId === 2 && (!scope.selector.entityId || (!finding && !guideRevision && interviews.length >= 10))) throw new ProbeFailure('TEACHING_SCOPE_NOT_VERIFIED');
      if (finding) {
        let record;
        try { record = JSON.parse(stageStates.get(2)?.content.draft.fields[`interviewRecord:${scope.selector.entityId}`]); } catch { /* Missing or corrupt saved guide. */ }
        if (scope.stageId !== 2 || record?.id !== scope.selector.entityId || !/^U(?:0[1-9]|10)$/.test(record.code) || !record.guideConfirmed
          || teachingLedger.get(revisionKey)?.scope.threadId !== scope.threadId || !teachingLedger.get(revisionKey)?.completed) throw new ProbeFailure('TEACHING_FINDING_SCOPE_NOT_VERIFIED');
      }
      if (teachingStopped || !ordinaryVerified || scope.projectId !== projectId || scope.actorId !== actor || teachingLedger.has(key) || teachingRequests >= TEACHING_TURN_LIMIT
        || !coordinates || coordinates.purpose !== (summary ? 'report' : 'stage') || coordinates.stageId !== scope.stageId || coordinates.entityId !== (summary ? 'group-report' : scope.selector.entityId)
        || !threadFacts.get(scope.threadId)?.writable || !pins.some(pin => pin.skillId === scope.skillId && pin.versionId === scope.skillVersionId)
        || skillCatalog.get(scope.skillId)?.stableName !== identity.teachingSkillNames?.[summary ? 6 : scope.stageId - 1]
        || scope.selector.stageRevisions.some(ref => stageStates.get(ref.stageId)?.revision !== ref.revision)
        || JSON.stringify(scope.knownMessages) !== JSON.stringify(messageSnapshots.get(scope.threadId))) throw new ProbeFailure('TEACHING_SCOPE_NOT_VERIFIED');
      arm = null;
      teachingLedger.set(key, { scope, wire: null, accepted: null, until: now() + 15000, ...(brainstorming ? { brainstormUntil: now() + 180000 } : {}), ...(scope.testPlan ? { planUntil: now() + 180000 } : {}) });
    },

    armSurveyCreate: entityId => {
      const group = testRecord(stageStates.get(6), entityId);
      if (!projectId || !ordinaryVerified || surveyArm || group?.method !== 'survey' || group.source
        || group.name !== `QA合成问卷 ${identity.run}-${identity.attempt}`) throw new ProbeFailure('SURVEY_CREATE_ARM_REJECTED');
      surveyArm = { entityId, until: now() + 60000 };
    },
    armSurveyPublish: () => {
      if (!survey?.linked || surveyPublishSent) throw new ProbeFailure('SURVEY_PUBLISH_ARM_REJECTED');
      survey.publishUntil = now() + 15000;
    },
    surveyReceipt: () => survey ? { ...survey } : null,
    armTestSave: ({ entityId, action, filename }) => {
      const group = testRecord(stageStates.get(6), entityId);
      if (!ordinaryVerified || !group || testSaveArm || !['method', 'survey', 'response', 'material'].includes(action)
        || action === 'material' && filename !== `qa-${identity.run}-${identity.attempt}-interview.txt`) throw new ProbeFailure('TEST_AUTOSAVE_ARM_REJECTED');
      arm = null;
      testSaveArm = { entityId, action, filename, until: now() + 45000 };
    },
    armDesignCreate: () => { if (!projectId || designId) throw new ProbeFailure('DESIGN_CREATE_ARM_REJECTED'); designArm = now() + 15000; },
    armDesignGeneration: () => { if (!designId || modelCount) throw new ProbeFailure('DESIGN_GENERATION_ARM_REJECTED'); modelArm = now() + 15000; },
    armDesignImage: ({ id, fileName, bytes }) => {
      let record;
      try { record = JSON.parse(stageStates.get(5)?.content.draft.fields[`prototypeEntity:${id}`]); } catch { /* No confirmed record. */ }
      if (!projectId || !ordinaryVerified || !designLinked || id !== designId || !resources.has(id) || imageCount || imageArm
        || record?.verificationQuestionConfirmed !== 'true' || !record.verificationQuestion?.trim() || !record.prototypeIdeaSource
        || fileName !== `qa-${identity.run}-prototype.png` || !Buffer.isBuffer(bytes) || bytes.length < 10 || bytes.length > 16_384
        || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new ProbeFailure('DESIGN_IMAGE_ARM_REJECTED');
      const source = 'data:image/png;base64,' + bytes.toString('base64');
      imageArm = { name: fileName, source, summary: 'AIDT 图片原型 · ' + createHash('sha256').update(source).digest('hex'), until: now() + 15000 };
    },
    registerFixture: ({ filename, bytes, mime }) => {
      if (!projectId || !Buffer.isBuffer(bytes) || bytes.length < 10 || bytes.length > 262144 || !filename.startsWith(`qa-${identity.run}-`) || !/^[A-Za-z0-9_.-]{1,180}$/.test(filename) || !['text/plain', 'image/png'].includes(mime)) throw new ProbeFailure('FIXTURE_REJECTED');
      const fixture = { filename, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mime };
      if (fixtures.has(filename)) throw new ProbeFailure('FIXTURE_REUSED'); fixtures.set(filename, fixture); uploadArm = { ...fixture, until: now() + 30000 }; return fixture;
    },
    observeContent: (decision, status, headers, bytes) => {
      const uploaded = uploads.get(decision.runId), version = headers['x-artifact-version-id'];
      if (status !== 200 || !uploaded || bytes.length !== uploaded.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== uploaded.sha256 || headers['x-content-sha256'] !== uploaded.sha256 || headers['x-artifact-id'] !== uploaded.artifactId || !/^[A-Za-z0-9_-]{1,256}$/.test(version ?? '')) throw new ProbeFailure('UPLOAD_CONTENT_UNVERIFIED');
      resources.add(version);
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
    summary: () => ({ readCategories: { ...readCategories }, readDenials: { ...readDenials }, metadataHttpStatuses: { items: metadataHttpStatuses.map(item => ({ ...item })), truncated: metadataHttpStatusesTruncated }, ordinaryRoleVerified: ordinaryVerified, profile: 'aidt', teachingRequestsAllowed: TEACHING_TURN_LIMIT, teachingRequests, teachingStopped, ownedTeachingRunCount: ownedRuns.size, suggestionsBlocked, loginRequests: loginCount, projectCreates: createCount, allowedWrites, reconcileCount, modelRequestsAllowed: 1, modelRequests: modelCount, designRequestedScreens: modelRequestedScreens, designModel: modelReceipt, roleWritesAllowed: 0, deletesAllowed: 0, projectId, ownedDesignId: designId, ownedThreadCount: threads.size, ownedUploadCount: uploads.size }),
  };
}

export function assertScreenshotSafe(text, secrets) {
  if (secrets.some(secret => typeof secret === 'string' && secret.length > 0 && text.includes(secret))) throw new ProbeFailure('SCREENSHOT_SENSITIVE_CONTENT');
}

export function assertCaptureScope(rawUrl, ownedProjectId, expectedStage) {
  let url; try { url = new URL(rawUrl); } catch { throw new ProbeFailure('SCREENSHOT_SCOPE_REJECTED'); }
  if (!PROJECT.test(ownedProjectId ?? '') || url.origin !== ORIGIN || url.username || url.password || url.pathname !== `/aidt/${ownedProjectId}` || (expectedStage !== undefined && (!Number.isInteger(expectedStage) || expectedStage < 1 || expectedStage > 6 || url.searchParams.get('step') !== String(expectedStage)))) throw new ProbeFailure('SCREENSHOT_SCOPE_REJECTED');
}
