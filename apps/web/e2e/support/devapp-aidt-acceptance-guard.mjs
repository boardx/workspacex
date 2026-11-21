/** Live Dev acceptance: this is a bounded test-data writer, not the read-only probe. */
import { ORIGIN, ProbeFailure, validLoginBody } from './devapp-aidt-auth-readonly.mjs';
import { createHash } from 'node:crypto';

export const SHA = /^[a-f0-9]{40}$/;
export const TAG = /^[0-9]+-[0-9]+$/;
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export const PROJECT = new RegExp(`^prj-${UUID}$`);
export const ENTITY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
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

export function createAcceptanceGuard(identity, now = Date.now) {
  let actor = null, org = null, candidate = null, projectId = null, loginArmed = false, fatal = null;
  let loginCount = 0, createCount = 0, arm = null, allowedWrites = 0, ordinaryVerified = false, projectCreateUntil = null;
  const threads = new Set(), resources = new Set(), uploads = new Map(), fixtures = new Map(), snapshots = new Map(), teachingSkills = new Set();
  let uploadArm = null, designArm = null, designId = null, modelArm = null, modelCount = 0, modelReceipt = null, modelRequestedScreens = null;
  const stop = code => { fatal ??= code; return { allow: false, kind: 'rejected', code }; };
  function decide({ url, method, resourceType, body }) {
    if (fatal) return { allow: false, kind: 'stopped', code: fatal };
    if (/%2f|%5c|%2e|\\/i.test(url.split('?')[0])) return stop('TARGET_REJECTED');
    let target;
    try { target = new URL(url); } catch { return stop('TARGET_REJECTED'); }
    if (target.origin !== ORIGIN || target.username || target.password || target.hash || /%2f|%5c|%2e|\\/i.test(target.pathname)) return stop('TARGET_REJECTED');
    if (new Set(target.searchParams.keys()).size !== [...target.searchParams.keys()].length) return stop('DUPLICATE_QUERY_REJECTED');
    const path = target.pathname;
    if (body !== undefined && Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY) return stop('REQUEST_BODY_BOUND');
    if (projectId && target.searchParams.has('projectId') && target.searchParams.get('projectId') !== projectId) return stop('FOREIGN_PROJECT_REFERENCE');
    if (allowedWrites >= 128 && method !== 'GET') return stop('WRITE_COUNT_BOUND');
    if (method === 'POST' && path === '/api/auth/login' && !target.search) {
      if (!loginArmed || actor || loginCount !== 0 || !object(body) || Object.keys(body).sort().join(',') !== 'email,password' || !body.email || !body.password) return stop('LOGIN_REJECTED');
      loginCount++; return { allow: true, kind: 'login' };
    }
    if (!actor && method !== 'GET') return stop('AUTHENTICATION_REQUIRED');
    if (identity.entryDiagnosticOnly && method !== 'GET') return stop('ENTRY_DIAGNOSTIC_READONLY');
    if (method === 'GET') {
      const publicPage = path === '/login' || path === '/aidt' || path === '/favicon.ico' || path.startsWith('/_next/static/') || approvedHomeImage(target);
      const accountRead = actor && (path === '/api/identity/me' || path === '/api/aidt/courses' || (path === '/api/projects' && target.searchParams.get('orgId') === org) || (path === '/api/skills' && target.searchParams.get('orgId') === org && [...target.searchParams.keys()].every(key => ['orgId', 'entry'].includes(key))));
      const ownedRead = (projectId || candidate) && (path === `/aidt/${projectId ?? candidate}` || path.startsWith(`/api/projects/${projectId ?? candidate}/`));
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
      if (!ordinaryVerified || !projectCreateUntil || now() > projectCreateUntil || createCount !== 0 || !object(body) || Object.keys(body).sort().join(',') !== 'blueprintVersionId,kind,name,orgId,profile' || body.orgId !== org || body.kind !== 'general' || body.blueprintVersionId !== null || body.profile !== 'aidt' || body.name !== identity.projectName) return stop('PROJECT_CREATE_REJECTED');
      projectCreateUntil = null; createCount++; allowedWrites++; return { allow: true, kind: 'create-project' };
    }
    if (!projectId) return stop('OWNED_PROJECT_REQUIRED');
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
      if (!arm || arm.stage !== n || arm.remaining < 1 || now() > arm.until) return stop('STAGE_SAVE_NOT_ARMED');
      const before = snapshots.get(n) ?? new Set();
      let next;
      try { next = confirmations(body.content); } catch (error) { return stop(error.code ?? 'CONFIRMATION_REJECTED'); }
      const changes = [...next].some(entry => !before.has(entry));
      if (changes && !arm.confirmation) return stop('CONFIRMATION_NOT_ARMED');
      arm.remaining--;
      if (Object.keys(body.content.draft).some(key => !ROOTS.has(key))) return stop('DRAFT_SCHEMA_REJECTED');
      allowedWrites++; return { allow: true, kind: 'save-stage', stageId: n };
    }
    const entity = new RegExp(`^/api/projects/${projectId}/aidt/stages/([1-6])/entities/([^/]+)/thread$`).exec(path);
    if (method === 'PUT' && entity && (ENTITY.test(entity[2]) || entity[2] === 'group-report') && object(body) && Object.keys(body).join(',') === 'purpose' && ['stage', 'report'].includes(body.purpose)) {
      allowedWrites++; return { allow: true, kind: 'entity-thread' };
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
  function observe(decision, status, response) {
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
      }
    } else if (decision.kind === 'skill-catalog' && status === 200 && Array.isArray(response?.items)) {
      for (const item of response.items) if (identity.teachingSkillNames?.includes(item.platformStableName) && item.status === '已启用' && typeof item.currentVersionId === 'string' && item.currentVersionId && typeof item.skillId === 'string') teachingSkills.add(item.skillId);
    } else if ((decision.kind === 'save-stage' || decision.kind === 'get-stage') && status === 200 && response?.stage) {
      if (response?.stage?.projectId !== projectId || response.stage.stageId !== decision.stageId) throw new ProbeFailure('STAGE_RESPONSE_REJECTED');
      snapshots.set(decision.stageId, confirmations(response.stage.content));
    }
  }
  return { decide, observe, fail: stop, fatal: () => fatal,
    armDesignCreate: () => { if (!projectId || designId) throw new ProbeFailure('DESIGN_CREATE_ARM_REJECTED'); designArm = now() + 15000; },
    armDesignGeneration: () => { if (!designId || modelCount) throw new ProbeFailure('DESIGN_GENERATION_ARM_REJECTED'); modelArm = now() + 15000; },
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
    armProjectCreate: () => { if (identity.entryDiagnosticOnly || !ordinaryVerified || candidate || projectId || createCount) throw new ProbeFailure('PROJECT_CREATE_ARM_REJECTED'); projectCreateUntil = now() + 15000; },
    armStageSave: (stage, confirmation = false) => { if (!projectId || !Number.isInteger(stage) || stage < 1 || stage > 6) throw new ProbeFailure('CONFIRMATION_ARM_REJECTED'); arm = { stage, confirmation, remaining: 2, until: now() + 15000 }; },
    bindOwnedProject: (overview, members) => {
      if (!candidate || projectId || overview?.projectId !== candidate || overview.name !== identity.projectName || !Array.isArray(members) || !members.some(item => item.userId === actor && item.role === 'owner')) throw new ProbeFailure('PROJECT_OWNERSHIP_UNVERIFIED');
      projectId = candidate;
    },
    identity: () => ({ actor, org, candidate, projectId, ordinaryVerified }),
    summary: () => ({ ordinaryRoleVerified: ordinaryVerified, profile: 'aidt', loginRequests: loginCount, projectCreates: createCount, allowedWrites, modelRequestsAllowed: 1, modelRequests: modelCount, designRequestedScreens: modelRequestedScreens, designModel: modelReceipt, roleWritesAllowed: 0, deletesAllowed: 0, projectId, ownedDesignId: designId, ownedThreadCount: threads.size, ownedUploadCount: uploads.size }),
  };
}

export function assertScreenshotSafe(text, secrets) {
  if (secrets.some(secret => typeof secret === 'string' && secret.length > 0 && text.includes(secret))) throw new ProbeFailure('SCREENSHOT_SENSITIVE_CONTENT');
}

export function assertCaptureScope(rawUrl, ownedProjectId, expectedStage) {
  let url; try { url = new URL(rawUrl); } catch { throw new ProbeFailure('SCREENSHOT_SCOPE_REJECTED'); }
  if (!PROJECT.test(ownedProjectId ?? '') || url.origin !== ORIGIN || url.username || url.password || url.pathname !== `/aidt/${ownedProjectId}` || (expectedStage !== undefined && (!Number.isInteger(expectedStage) || expectedStage < 1 || expectedStage > 6 || url.searchParams.get('step') !== String(expectedStage)))) throw new ProbeFailure('SCREENSHOT_SCOPE_REJECTED');
}
