/** Live Dev acceptance: this is a bounded test-data writer, not the read-only probe. */
import { ORIGIN, ProbeFailure, validLoginBody } from './devapp-aidt-auth-readonly.mjs';
import { createSurveyCollectionGuard } from './devapp-aidt-survey.mjs';
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

export function aidtSyntheticInterviewAudio(run, attempt) {
  if (![run, attempt].every(value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value))) {
    throw new ProbeFailure('SYNTHETIC_WAV_IDENTITY_INVALID');
  }
  const filename = `qa-${run}-${attempt}-U01-synthetic.wav`;
  const sampleRate = 8000;
  const bytes = Buffer.alloc(44 + sampleRate * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(sampleRate * 2, 40);
  for (let i = 0; i < sampleRate; i++) {
    bytes.writeInt16LE(Math.round(2200 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), 44 + i * 2);
  }
  // Make the tone unique to this run, without using any captured or spoken audio.
  const marker = createHash('sha256').update(filename).digest();
  for (const [index, value] of marker.entries()) bytes.writeInt16LE(value - 128, 44 + index * 2);
  return { filename, bytes, mime: 'audio/wav' };
}

export function aidtSyntheticStageText(run, attempt, stageId) {
  if (![run, attempt].every(value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value))
    || !Number.isInteger(stageId) || stageId < 1 || stageId > 6) throw new ProbeFailure('STAGE_TEXT_IDENTITY_INVALID');
  const filename = `qa-${run}-${attempt}-stage-${stageId}.txt`;
  const bytes = Buffer.from(`Synthetic attachment verification. Run ${run}-${attempt}, stage ${stageId}. No research evidence.\n`);
  return { filename, bytes, mime: 'text/plain' };
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

export function createAcceptanceGuard(identity, now = Date.now) {
  let actor = null, org = null, candidate = null, projectId = null, loginArmed = false, fatal = null;
  let loginCount = 0, createCount = 0, arm = null, allowedWrites = 0, ordinaryVerified = false, projectCreateUntil = null, projectCourseTag;
  const threadCoordinates = new Map(), threadFacts = new Map(), threadPins = new Map(), messageSnapshots = new Map(), stageStates = new Map(), skillCatalog = new Map(), teachingLedger = new Map(), ownedRuns = new Set();
  let reconcileCount = 0;
  let teachingRequests = 0, suggestionsBlocked = 0, teachingStopped = false, isolatedProblemReceipt = null;
  const threads = new Set(), resources = new Set(), uploads = new Map(), fixtures = new Map(), snapshots = new Map(), teachingSkills = new Set();
  let imageArm = null, imageCount = 0, designLinked = false;
  let uploadArm = null, designArm = null, designId = null, modelArm = null, modelCount = 0, modelReceipt = null, modelRequestedScreens = null;
  const stageText = new Map();
  const survey = createSurveyCollectionGuard(identity.run);

  function stageTextRead(path, target) {
    const match = /^\/api\/chat\/threads\/([^/]+)\/attachments\/([^/]+)\/content$/.exec(path);
    if (!match) return null;
    const verified = [...stageText.values()].find(entry => entry.attachmentId && encodeURIComponent(entry.attachmentId) === match[2]);
    if (!verified) return null;
    return (verified.messageId && match[1] === encodeURIComponent(verified.threadId) && !target.search)
      ? { allow: true, kind: 'qa-stage-text-content', stageId: verified.stageId }
      : { allow: false, kind: 'out-of-scope-read', code: 'STAGE_TEXT_READ_SCOPE_REJECTED' };
  }

  const readCategories = { nativeAgentCatalog: 0, runtimeMetadata: 0, other: 0 };
  const readDenials = { nativeAgentCatalog: 0, runtimeMetadata: 0, other: 0 };
  const metadataHttpStatuses = [];
  let metadataHttpStatusesTruncated = false;
  const stop = code => { fatal ??= code; return { allow: false, kind: 'rejected', code }; };
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
      const stageFile = stageTextRead(path, target);
      if (stageFile) return stageFile;
      // Native AgentOptions reads only this organization's agent catalog. This
      // does not authorize capability mutations or requests before QA ownership.
      if (path === '/api/capabilities' && ordinaryVerified && projectId
        && [...target.searchParams.keys()].sort().join(',') === 'kind,orgId'
        && target.searchParams.get('orgId') === org && target.searchParams.get('kind') === 'agent') {
        return { allow: true, kind: 'native-agent-catalog' };
      }
      if (actor && path === '/api/projects' && target.searchParams.get('orgId') === org
        && [...target.searchParams.keys()].join(',') === 'orgId') {
        return { allow: true, kind: 'qa-project-catalog', projectId };
      }
      const publicPage = path === '/login' || path === '/aidt' || path === '/favicon.ico' || path.startsWith('/_next/static/') || approvedHomeImage(target);
      const accountRead = actor && (path === '/api/identity/me' || path === '/api/aidt/courses' || (path === '/api/copilotkit/info' && !target.search) || (path === '/api/skills' && target.searchParams.get('orgId') === org && [...target.searchParams.keys()].every(key => ['orgId', 'entry'].includes(key))));
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
    if (method === 'POST' && /^\/api\/chat\/threads\/[^/]+\/attachments$/.test(path)) {
      const entry = [...stageText.values()].find(item => path === `/api/chat/threads/${encodeURIComponent(item.threadId)}/attachments`);
      const file = body?.files?.[0];
      if (target.search || !entry || entry.uploadStarted || now() > entry.until
        || body?.__multipart !== true || Object.keys(body).sort().join(',') !== '__multipart,files' || !Array.isArray(body.files) || body.files.length !== 1
        || !object(file) || Object.keys(file).sort().join(',') !== 'filename,mime,sha256,sizeBytes'
        || file.filename !== entry.filename || file.mime !== entry.mime
        || file.sizeBytes !== entry.sizeBytes || file.sha256 !== entry.sha256) return stop('STAGE_TEXT_UPLOAD_SCOPE_REJECTED');
      entry.uploadStarted = true;
      allowedWrites++;
      return { allow: true, kind: 'qa-stage-text-upload', stageId: entry.stageId };
    }
    if (method === 'POST' && path === '/api/copilotkit/agent/default/run') {
      const entries = [...teachingLedger.values()].filter(entry => entry.wire === null && entry.until >= now());
      if (teachingStopped || teachingRequests >= TEACHING_TURN_LIMIT || entries.length !== 1) return stop('TEACHING_SEND_NOT_ARMED');
      const entry = entries[0];
      try { entry.wire = validateTeachingWire({ url, method, body }, entry.scope); } catch (error) { return stop(error.code ?? 'TEACHING_WIRE_REJECTED'); }
      teachingRequests++; return { allow: true, kind: 'teaching-turn', stageId: entry.scope.stageId, threadId: entry.scope.threadId };
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
    survey.observe(decision.kind, status, response);
    if (decision.kind === 'survey-create') resources.add(survey.receipt().id);
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
    } else if (decision.kind === 'qa-stage-text-upload') {
      const entry = stageText.get(decision.stageId);
      if (!entry?.uploadStarted || entry.attachmentId || ![200, 201].includes(status)
        || !/^[A-Za-z0-9_.:-]{1,180}$/.test(response?.id ?? '')
        || [...stageText.values()].some(item => item.attachmentId === response.id)
        || response.filename !== entry.filename || response.bytes !== entry.sizeBytes || response.mime !== entry.mime) {
        throw new ProbeFailure('STAGE_TEXT_UPLOAD_RECEIPT_REJECTED');
      }
      entry.attachmentId = response.id;
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
        if (accepted) {
          if (entry.accepted && entry.accepted.runId !== accepted.runId) throw new ProbeFailure('TEACHING_RUN_BINDING_CHANGED');
          entry.accepted = accepted;
          ownedRuns.add(accepted.runId);
          if (entry.scope.stageFile) {
            const file = stageText.get(entry.scope.stageId);
            if (file.attachmentId !== entry.scope.stageFile.id || file.messageId && file.messageId !== accepted.inputMessageId) throw new ProbeFailure('STAGE_TEXT_BINDING_CHANGED');
            file.messageId = accepted.inputMessageId;
          }
        }
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
    armStageText: scope => {
      const selector = validateTeachingScope(scope);
      const coordinates = threadCoordinates.get(scope.threadId);
      if (stageText.has(scope.stageId) || !ordinaryVerified || scope.projectId !== projectId || scope.actorId !== actor
        || selector.purpose !== 'stage' || !selector.entityId || coordinates?.stageId !== scope.stageId
        || coordinates.entityId !== selector.entityId || coordinates.purpose !== 'stage'
        || !threadFacts.get(scope.threadId)?.writable) throw new ProbeFailure('STAGE_TEXT_UPLOAD_ARM_REJECTED');
      const fixture = aidtSyntheticStageText(identity.run, identity.attempt, scope.stageId);
      stageText.set(scope.stageId, { stageId: scope.stageId, entityId: selector.entityId, threadId: scope.threadId,
        filename: fixture.filename, mime: fixture.mime, sizeBytes: fixture.bytes.length,
        sha256: createHash('sha256').update(fixture.bytes).digest('hex'), until: now() + 30000 });
      return fixture;
    },
    stageTextReceipt: stageId => {
      const entry = stageText.get(stageId);
      if (!entry?.attachmentId) return null;
      const { attachmentId: id, filename, mime, sizeBytes, sha256, entityId, threadId, messageId, contentVerified } = entry;
      return { id, filename, mime, bytes: sizeBytes, sha256, entityId, threadId, messageId, contentVerified: contentVerified === true };
    },
    armTeachingSend: scope => {
      validateTeachingScope(scope);
      if (scope.stageFile) {
        const file = stageText.get(scope.stageId);
        if (!file?.attachmentId || file.messageId || file.attachmentId !== scope.stageFile.id || file.filename !== scope.stageFile.filename
          || file.sizeBytes !== scope.stageFile.bytes || file.mime !== scope.stageFile.mime || file.entityId !== scope.selector.entityId
          || file.threadId !== scope.threadId) throw new ProbeFailure('STAGE_TEXT_WIRE_NOT_VERIFIED');
      }
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

    armSurvey(entityId) {
      let record;
      try { record = JSON.parse(stageStates.get(6)?.content?.draft?.fields?.['testGroup:' + entityId]); } catch {}
      if (!ordinaryVerified || !projectId || !designId || record?.designId !== designId || record.method !== 'survey' || !record.versionId || !record.planFromMessageId) throw new ProbeFailure('SURVEY_TEST_ENTITY_REQUIRED');
      survey.arm();
    },
    surveyReceipt: survey.receipt,
    decideSurveyParticipant({ url, method, body }) {
      if (fatal) return { allow: false, kind: 'stopped', code: fatal };
      const target = new URL(url), publicLink = survey.publicLink();
      if (target.origin !== ORIGIN || target.username || target.password || target.hash
        || target.search || /%2e|%2f|%5c|\\/i.test(url.split('?')[0]) || !publicLink) return { allow: false };
      if (method === 'GET' && (target.pathname === publicLink || target.pathname === '/api/public' + publicLink
        || target.pathname.startsWith('/_next/static/') || target.pathname === '/favicon.ico')) return { allow: true, kind: 'read' };
      if (method === 'POST' && target.pathname === '/api/public' + publicLink + '/responses'
        && allowedWrites - reconcileCount < WRITE_LIMIT && Buffer.byteLength(JSON.stringify(body ?? null), 'utf8') <= MAX_BODY) {
        const decision = survey.decide(method, target, body, projectId, 'survey-participant');
        if (decision?.allow) { allowedWrites++; return decision; }
      }
      return { allow: false };
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
    registerFixture: ({ filename, bytes, mime, interviewEntityId }) => {
      if (!projectId || !Buffer.isBuffer(bytes) || bytes.length < 10 || bytes.length > 262144 || !filename.startsWith(`qa-${identity.run}-`) || !/^[A-Za-z0-9_.-]{1,180}$/.test(filename)) throw new ProbeFailure('FIXTURE_REJECTED');
      if (mime === 'audio/wav') {
        const sample = aidtSyntheticInterviewAudio(identity.run, identity.attempt);
        let interview;
        try { interview = JSON.parse(stageStates.get(2)?.content?.draft?.fields?.[`interviewRecord:${interviewEntityId}`]); }
        catch { /* No saved interview reference. */ }
        if (!ordinaryVerified || interview?.id !== interviewEntityId || interview?.code !== 'U01'
          || interview.archived || interview.consent?.audio !== true || filename !== sample.filename || !bytes.equals(sample.bytes)) {
          throw new ProbeFailure('SYNTHETIC_WAV_SCOPE_REJECTED');
        }
      } else if (!['text/plain', 'image/png'].includes(mime) || interviewEntityId !== undefined) {
        throw new ProbeFailure('FIXTURE_REJECTED');
      }
      const fixture = { filename, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mime };
      if (fixtures.has(filename)) throw new ProbeFailure('FIXTURE_REUSED'); fixtures.set(filename, fixture); uploadArm = { ...fixture, until: now() + 30000 }; return fixture;
    },
    observeContent: (decision, status, headers, bytes) => {
      if (decision.kind === 'qa-stage-text-content') {
        const entry = stageText.get(decision.stageId);
        if (status !== 200 || !entry?.messageId || headers['content-type']?.split(';')[0] !== entry.mime
          || bytes.length !== entry.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
          throw new ProbeFailure('STAGE_TEXT_CONTENT_UNVERIFIED');
        }
        entry.contentVerified = true;
        return;
      }
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
