import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { acceptanceIdentity, assertAcceptanceWorkflow, assertRuntimeProof, createAcceptanceGuard, assertScreenshotSafe, assertCaptureScope } from '../../apps/web/e2e/support/devapp-aidt-acceptance-guard.mjs';
import { enforceDeniedProbeStatus } from '../../apps/web/e2e/support/devapp-aidt-acceptance.mjs';
import { interviewCodePattern } from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';

const source = 'a'.repeat(40), project = 'prj-11111111-1111-4111-8111-111111111111';
const identity = () => acceptanceIdentity({ EXPECTED_SOURCE_SHA: source, EXPECTED_RELEASE_TAG: '123-1', GITHUB_RUN_ID: '456', GITHUB_RUN_ATTEMPT: '1' });
const request = (guard, method, path, body) => guard.decide({ url: `https://devapp.boardx.us${path}`, method, body, resourceType: 'fetch' });
function owned(options = {}) {
  const id = { ...identity(), teachingSkillNames: ['aidt-understand'], ...options }, guard = createAcceptanceGuard(id, () => options.now?.() ?? 100);
  guard.armLogin();
  const login = request(guard, 'POST', '/api/auth/login', { email: 'synthetic-only', password: 'synthetic-only' });
  guard.observe(login, 200, { userId: 'qa-user', orgs: ['qa-org'], sessionToken: 'synthetic-token', expiresAt: '2099-01-01T00:00:00Z' });
  const create = request(guard, 'POST', '/api/projects', { orgId: 'qa-org', name: id.projectName, kind: 'general', blueprintVersionId: null });
  assert.equal(create.allow, true);
  guard.observe(create, 201, { id: project, kind: 'general', status: 'active', provenanceEventId: 'qa-event' });
  return { guard, bind: () => guard.bindOwnedProject({ projectId: project, name: id.projectName }, [{ userId: 'qa-user', role: 'owner' }]) };
}
const stageBody = (fields = {}) => ({ operationId: 'op-qa', expectedRevision: 0, content: { schemaVersion: 1, draft: { fields, ideas: [], selectedIdeaId: null } }, sourceStageRevisions: [] });

test('identity requires explicit deployed SHA/tag and positive run identity', () => {
  assert.equal(identity().projectName, 'AIDT QA synthetic 456-1');
  for (const patch of [{ EXPECTED_SOURCE_SHA: 'main' }, { EXPECTED_RELEASE_TAG: 'latest' }, { GITHUB_RUN_ID: '0' }, { GITHUB_RUN_ATTEMPT: 'x' }]) {
    assert.throws(() => acceptanceIdentity({ EXPECTED_SOURCE_SHA: source, EXPECTED_RELEASE_TAG: '123-1', GITHUB_RUN_ID: '456', GITHUB_RUN_ATTEMPT: '1', ...patch }), /ACCEPTANCE_IDENTITY_INVALID/);
  }
});
test('interview UI labels match spaces and newlines without template-string escape loss', () => {
  for (const code of ['U01', 'U02']) {
    assert.equal(interviewCodePattern(code).test(`${code} 合成受访者`), true);
    assert.equal(interviewCodePattern(code).test(`${code}\n发现卡已核对`), true);
    assert.equal(interviewCodePattern(code).test(`${code}3 unexpected code`), false);
    assert.equal(interviewCodePattern(code).test(`${code}s swallowed escape`), false);
  }
  assert.throws(() => interviewCodePattern('U03'), /INTERVIEW_CODE_UNEXPECTED/);
});
test('credential-bearing lane is manual develop only in the official repository', () => {
  const context = { GITHUB_REPOSITORY: 'boardx/workspacex', GITHUB_REF: 'refs/heads/develop', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: source };
  assertAcceptanceWorkflow(context);
  for (const patch of [{ GITHUB_REPOSITORY: 'other/repo' }, { GITHUB_REF: 'refs/heads/main' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_SHA: 'main' }]) assert.throws(() => assertAcceptanceWorkflow({ ...context, ...patch }), /MANUAL_DEVELOP_WORKFLOW_REQUIRED/);
});
test('exact runtime requires observed four images, matching source/tag and digest', () => {
  const proof = { aidtExactRelease: { status: 'OBSERVED', containers: ['api', 'web', 'agent', 'sandbox'].map(role => ({ role, sourceRevision: source, tag: '123-1', imageId: `sha256:${'b'.repeat(64)}` })) } };
  assert.equal(assertRuntimeProof(proof, identity()).containers.length, 4);
  const bad = structuredClone(proof); bad.aidtExactRelease.containers[0].sourceRevision = 'c'.repeat(40);
  assert.throws(() => assertRuntimeProof(bad, identity()), /EXACT_RUNTIME_MISMATCH/);
  proof.aidtExactRelease.containers.pop(); assert.throws(() => assertRuntimeProof(proof, identity()), /EXACT_RUNTIME_ROLES_MISSING/);
});
test('credential source remains existing read-only helper; no default live writes before arm', () => {
  const guard = createAcceptanceGuard(identity());
  assert.equal(request(guard, 'POST', '/api/auth/login', { email: 'qa', password: 'qa' }).code, 'LOGIN_REJECTED');
  assert.equal(guard.summary().loginRequests, 0);
});
test('new project requires response receipt plus matching name and actual QA owner', () => {
  const { guard } = owned();
  assert.equal(request(guard, 'PATCH', `/api/projects/${project}/tags`, { projectId: project, tags: ['workspacex:aidt'] }).code, 'OWNED_PROJECT_REQUIRED');
  const fresh = owned();
  assert.throws(() => fresh.guard.bindOwnedProject({ projectId: project, name: identity().projectName }, [{ userId: 'qa-user', role: 'collaborator' }]), /PROJECT_OWNERSHIP_UNVERIFIED/);
  fresh.bind();
  assert.equal(request(fresh.guard, 'PATCH', `/api/projects/${project}/tags`, { projectId: project, tags: ['workspacex:aidt'] }).allow, true);
});
test('cross-origin and encoded path escapes stop all future requests', () => {
  for (const url of ['https://app.workspacex.cn/aidt', `https://devapp.boardx.us/api/projects/${project}/%2e%2e/other`, 'https://user@devapp.boardx.us/aidt']) {
    const { guard, bind } = owned(); bind();
    assert.equal(guard.decide({ url, method: 'GET' }).allow, false);
    assert.equal(request(guard, 'GET', '/aidt').allow, false);
  }
});
test('duplicate scope query cannot select a foreign project or org through parser disagreement', () => {
  const { guard, bind } = owned(); bind();
  assert.equal(request(guard, 'GET', `/api/projects/${project}/overview?projectId=${project}&projectId=foreign`).code, 'DUPLICATE_QUERY_REJECTED');
});
test('random unknown project probe aborts unexpected success before reading or fulfilling its body', async () => {
  const { guard, bind } = owned({ deniedProject: 'prj-22222222-2222-4222-8222-222222222222' }); bind();
  const decision = request(guard, 'GET', '/api/projects/prj-22222222-2222-4222-8222-222222222222/overview');
  assert.equal(decision.kind, 'denied-probe');
  let disposed = false, bodyRead = false;
  const response = { status: () => 200, dispose: async () => { disposed = true; }, body: async () => { bodyRead = true; return Buffer.from('must never read'); } };
  await assert.rejects(enforceDeniedProbeStatus(decision, response), /UNKNOWN_PROJECT_UNEXPECTED_RESPONSE/);
  assert.equal(disposed, true); assert.equal(bodyRead, false);
  for (const status of [403, 404]) await enforceDeniedProbeStatus(decision, { status: () => status, dispose: async () => assert.fail('should not dispose expected denial') });
});
test('DELETE, permissions, courses and arbitrary skill approval writes cannot run', () => {
  for (const [method, path] of [['DELETE', `/api/projects/${project}`], ['POST', `/api/projects/${project}/collaborators`], ['POST', '/api/aidt/courses'], ['POST', '/api/threads/thr_qa/skill-mounts/policy']]) {
    const { guard, bind } = owned(); bind(); assert.equal(request(guard, method, path, {}).allow, false);
  }
});
test('all stage saves require current short-lived visible UI action', () => {
  const { guard, bind } = owned(); bind();
  assert.equal(request(guard, 'PUT', `/api/projects/${project}/aidt/stages/1`, stageBody()).code, 'STAGE_SAVE_NOT_ARMED');
  let now = 100; const another = owned({ now: () => now }); another.bind(); another.guard.armStageSave(1); now += 15001;
  assert.equal(request(another.guard, 'PUT', `/api/projects/${project}/aidt/stages/1`, stageBody()).code, 'STAGE_SAVE_NOT_ARMED');
});
test('plain save allows false markers, but rejects nested/encoded new confirmation', () => {
  const { guard, bind } = owned(); bind(); guard.armStageSave(1);
  assert.equal(request(guard, 'PUT', `/api/projects/${project}/aidt/stages/1`, stageBody({ surpriseConfirmed: 'false', confirmedIds: '[]' })).allow, true);
  assert.equal(request(guard, 'PUT', `/api/projects/${project}/aidt/stages/1`, stageBody({ entity: JSON.stringify({ payload: { problemReflectionConfirmed: 'true' } }) })).code, 'CONFIRMATION_NOT_ARMED');
});
test('review arm permits normal UI confirmation; reply scopes must match', () => {
  const { guard, bind } = owned(); bind(); guard.armStageSave(1, true);
  const decision = request(guard, 'PUT', `/api/projects/${project}/aidt/stages/1`, stageBody({ reflectionConfirmed: 'true' }));
  assert.equal(decision.allow, true);
  assert.throws(() => guard.observe(decision, 200, { stage: { projectId: 'foreign', stageId: 1, content: {} } }), /STAGE_RESPONSE_REJECTED/);
});
test('large or deep encoded JSON cannot skip reference or confirmation checks', () => {
  const { guard, bind } = owned(); bind(); guard.armStageSave(1, true);
  assert.equal(request(guard, 'PUT', `/api/projects/${project}/aidt/stages/1`, stageBody({ value: 'x'.repeat(1048576) })).code, 'REQUEST_BODY_BOUND');
  const next = owned(); next.bind(); next.guard.armStageSave(1, true);
  assert.equal(request(next.guard, 'PUT', `/api/projects/${project}/aidt/stages/1`, stageBody({ json: JSON.stringify({ projectId: 'foreign' }) })).code, 'FOREIGN_PROJECT_REFERENCE');
});
test('foreign artifact and thread IDs are denied even nested in JSON strings', () => {
  for (const ref of [{ threadId: 'thr_foreign' }, { artifactId: 'artifact-foreign' }, { versionId: 'version-foreign' }, { designId: 'design-foreign' }]) {
    const { guard, bind } = owned(); bind(); guard.armStageSave(2, true);
    assert.equal(request(guard, 'PUT', `/api/projects/${project}/aidt/stages/2`, stageBody({ evidence: JSON.stringify(ref) })).allow, false);
  }
});
test('only actual owned entity thread receipt enables exact teaching mount', () => {
  const { guard, bind } = owned(); bind();
  const create = request(guard, 'PUT', `/api/projects/${project}/aidt/stages/2/entities/qa-interview/thread`, { purpose: 'stage' });
  assert.equal(create.allow, true); guard.observe(create, 200, { threadId: 'thr_qa-synthetic' });
  const catalog = request(guard, 'GET', '/api/skills?orgId=qa-org&entry=library');
  guard.observe(catalog, 200, { items: [{ name: 'Display title', platformStableName: 'aidt-understand', status: '已启用', currentVersionId: 'version-qa', skillId: 'skill-qa' }, { name: 'aidt-understand', platformStableName: 'other', status: '已启用', currentVersionId: 'version-other', skillId: 'skill-other' }] });
  assert.equal(request(guard, 'POST', `/api/threads/thr_qa-synthetic/skill-mounts?projectId=${project}`, { threadId: 'thr_qa-synthetic', skillIds: ['skill-qa'], expectedVersion: '0' }).allow, true);
  assert.equal(request(guard, 'POST', `/api/threads/thr_qa-synthetic/skill-mounts?projectId=${project}`, { threadId: 'thr_qa-synthetic', skillIds: ['skill-other'], expectedVersion: '0' }).allow, false);
});
test('fixture upload requires one registered run file, fresh receipt and exact original hash', () => {
  const { guard, bind } = owned(); bind(); const bytes = Buffer.from('QA synthetic original evidence 456 only');
  const file = guard.registerFixture({ filename: 'qa-456-evidence.txt', bytes, mime: 'text/plain' });
  const meta = { projectId: project, agendaSegmentId: null, files: [{ filename: file.filename, sizeBytes: file.sizeBytes, sha256: file.sha256 }], confidential: false, visibilityScope: 'org-wide', onDuplicate: 'use-existing' };
  const upload = request(guard, 'POST', `/api/projects/${project}/artifacts/upload`, { __multipart: true, meta, files: [file] });
  assert.equal(upload.allow, true); guard.observe(upload, 201, { runs: [{ artifactId: 'artifact-qa', ingestionRunId: 'run-qa', duplicateHit: false }] });
  const read = request(guard, 'GET', `/api/ingestion-runs/run-qa/content?projectId=${project}`);
  assert.equal(read.allow, true); guard.observeContent(read, 200, { 'x-artifact-version-id': 'version-qa', 'x-content-sha256': createHash('sha256').update(bytes).digest('hex'), 'x-artifact-id': 'artifact-qa' }, bytes);
  guard.armStageSave(2); assert.equal(request(guard, 'PUT', `/api/projects/${project}/aidt/stages/2`, stageBody({ material: JSON.stringify({ projectId: project, runId: 'run-qa', artifactId: 'artifact-qa', versionId: 'version-qa' }) })).allow, true);
  assert.equal(request(guard, 'GET', `/api/ingestion-runs/not-created/content?projectId=${project}`).allow, false);
});
test('duplicate upload receipt and redirects fail closed', () => {
  const { guard, bind } = owned(); bind();
  assert.throws(() => guard.observe({ kind: 'upload', fixture: {} }, 201, { runs: [{ artifactId: 'artifact-old', ingestionRunId: 'run-old', duplicateHit: true }] }), /UPLOAD_RECEIPT_REJECTED/);
  assert.throws(() => guard.observe({ kind: 'read' }, 302), /REDIRECT_REJECTED/);
});
test('screenshot secret checks reject actual secret values, not innocent field labels', () => {
  assertScreenshotSafe('The word password is not a credential', ['specific-secret']);
  assert.throws(() => assertScreenshotSafe('input value specific-secret', ['specific-secret']), /SCREENSHOT_SENSITIVE_CONTENT/);
  assert.throws(() => assertScreenshotSafe('short=ab', ['ab']), /SCREENSHOT_SENSITIVE_CONTENT/);
});
test('capture rejects login, homepage, foreign or unbound projects before any bytes are written', () => {
  assertCaptureScope(`https://devapp.boardx.us/aidt/${project}?step=2`, project, 2);
  for (const url of ['https://devapp.boardx.us/login', 'https://devapp.boardx.us/aidt', 'https://app.workspacex.cn/aidt/' + project, 'https://devapp.boardx.us/aidt/prj-22222222-2222-4222-8222-222222222222']) assert.throws(() => assertCaptureScope(url, project), /SCREENSHOT_SCOPE_REJECTED/);
  assert.throws(() => assertCaptureScope(`https://devapp.boardx.us/aidt/${project}`, null), /SCREENSHOT_SCOPE_REJECTED/);
  assert.throws(() => assertCaptureScope(`https://devapp.boardx.us/aidt/${project}?step=2`, project, 1), /SCREENSHOT_SCOPE_REJECTED/);
});
test('Design creation is armed once, owned by QA, and only that new ID may be attached', () => {
  const { guard, bind } = owned(); bind(); guard.armDesignCreate();
  const create = request(guard, 'POST', '/api/pm-designs', { name: '未命名设计', template: 'ui' });
  assert.equal(create.allow, true);
  guard.observe(create, 201, { project: { id: 'design-qa', name: '未命名设计', template: 'ui', ownerId: 'qa-user', frames: [], share: null } });
  assert.equal(request(guard, 'POST', `/api/projects/${project}/resources`, { projectId: project, kind: 'design', resourceId: 'design-qa' }).allow, true);
  assert.equal(request(guard, 'POST', `/api/projects/${project}/resources`, { projectId: project, kind: 'design', resourceId: 'design-foreign' }).allow, false);
});
test('one bounded Design model request; fallback or failure cannot silently retrigger', () => {
  const { guard, bind } = owned(); bind(); guard.armDesignCreate();
  const create = request(guard, 'POST', '/api/pm-designs', { name: '未命名设计', template: 'ui' });
  guard.observe(create, 201, { project: { id: 'design-qa', name: '未命名设计', template: 'ui', ownerId: 'qa-user', frames: [], share: null } });
  guard.armDesignGeneration();
  const send = request(guard, 'POST', '/api/pm-designs/design-qa/chat', { text: 'QA 456 synthetic generation', maxScreens: 1 });
  assert.equal(send.allow, true);
  guard.observe(send, 200, { project: { id: 'design-qa', ownerId: 'qa-user', frames: [] }, reply: { source: 'fallback' } });
  assert.equal(guard.summary().modelRequests, 1); assert.equal(guard.summary().designModel.replySource, 'fallback');
  assert.throws(() => guard.armDesignGeneration(), /DESIGN_GENERATION_ARM_REJECTED/);
  assert.equal(request(guard, 'POST', '/api/pm-designs/design-qa/chat', { text: 'QA 456 retry' }).allow, false);
});
test('normal first Design send preserves default service page count without claiming one-page enforcement', () => {
  const { guard, bind } = owned(); bind(); guard.armDesignCreate();
  const create = request(guard, 'POST', '/api/pm-designs', { name: '未命名设计', template: 'ui' });
  guard.observe(create, 201, { project: { id: 'design-qa', name: '未命名设计', template: 'ui', ownerId: 'qa-user', frames: [], share: null } });
  guard.armDesignGeneration();
  assert.equal(request(guard, 'POST', '/api/pm-designs/design-qa/chat', { text: 'QA 456 normal first UI send' }).allow, true);
  assert.equal(guard.summary().designRequestedScreens, 'service-default');
  assert.equal(guard.summary().modelRequests, 1);
});
