import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, chmodSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { acceptanceIdentity, assertAcceptanceWorkflow, assertRuntimeProof, createAcceptanceGuard, assertScreenshotSafe, assertCaptureScope, approvedHomeImage } from '../../apps/web/e2e/support/devapp-aidt-acceptance-guard.mjs';
import { enforceDeniedProbeStatus, verifyPng, finalizeGuardVerdict, privateOutput, publicEntryDiagnostic, ordinaryQaProvisioningRequested, sensitiveEvidenceGuard, assertProvisionedOrdinaryQa, pendingTeachingReviewReceipt, observePendingTeachingReview, recordTeachingEvent } from '../../apps/web/e2e/support/devapp-aidt-acceptance.mjs';
import { interviewCodePattern } from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';

const source = 'a'.repeat(40), project = 'prj-11111111-1111-4111-8111-111111111111';
const syntheticLoginValue = 'synthetic-only'; // Unit fixture, never an account credential.
const identity = () => acceptanceIdentity({ EXPECTED_SOURCE_SHA: source, EXPECTED_RELEASE_TAG: '123-1', GITHUB_RUN_ID: '456', GITHUB_RUN_ATTEMPT: '1' });
const request = (guard, method, path, body) => guard.decide({ url: `https://devapp.boardx.us${path}`, method, body, resourceType: 'fetch' });
function owned(options = {}) {
  const id = { ...identity(), teachingSkillNames: ['aidt-understand'], ...options }, guard = createAcceptanceGuard(id, () => options.now?.() ?? 100);
  guard.armLogin();
  const login = request(guard, 'POST', '/api/auth/login', { email: syntheticLoginValue, password: syntheticLoginValue });
  guard.observe(login, 200, { userId: 'qa-user', orgs: ['qa-org'], sessionToken: 'synthetic-token', expiresAt: '2099-01-01T00:00:00Z' });
  guard.verifyOrdinaryIdentity(200, { org: { id: 'qa-org' }, orgRole: 'consultant' }); guard.armProjectCreate();
  const create = request(guard, 'POST', '/api/projects', { orgId: 'qa-org', name: id.projectName, kind: 'general', blueprintVersionId: null, profile: 'aidt' });
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
  for (const code of ['U01', 'U02', 'U03', 'U10']) {
    assert.equal(interviewCodePattern(code).test(`${code} 合成受访者`), true);
    assert.equal(interviewCodePattern(code).test(`${code}\n发现卡已核对`), true);
    assert.equal(interviewCodePattern(code).test(`${code}3 unexpected code`), false);
    assert.equal(interviewCodePattern(code).test(`${code}s swallowed escape`), false);
  }
  assert.equal(interviewCodePattern('U03').test('U10 合成受访者'), false);
  assert.equal(interviewCodePattern('U10').test('U100 合成受访者'), false);
  for (const code of ['U00', 'U11', 'U010', 'U03.*', ' U10', undefined]) {
    assert.throws(() => interviewCodePattern(code), /INTERVIEW_CODE_UNEXPECTED/);
  }
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
  assert.equal(request(fresh.guard, 'PATCH', `/api/projects/${project}/tags`, { projectId: project, tags: ['workspacex:aidt'] }).allow, false);
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
test('native agent catalog requires the verified ordinary actor and bound owned QA project', () => {
  const path = '/api/capabilities?orgId=qa-org&kind=agent';
  const unauthenticated = createAcceptanceGuard(identity());
  assert.equal(request(unauthenticated, 'GET', path).allow, false);
  const unverified = createAcceptanceGuard(identity()); unverified.armLogin();
  const login = request(unverified, 'POST', '/api/auth/login', { email: syntheticLoginValue, password: syntheticLoginValue });
  unverified.observe(login, 200, { userId: 'qa-user', orgs: ['qa-org'], sessionToken: 'synthetic-token', expiresAt: '2099-01-01T00:00:00Z' });
  unverified.readIdentityRole(200, { org: { id: 'qa-org' }, orgRole: 'admin' });
  assert.equal(request(unverified, 'GET', path).allow, false);
  const { guard, bind } = owned();
  assert.equal(request(guard, 'GET', path).allow, false); // Receipt alone is not an ownership binding.
  bind();
  assert.deepEqual(request(guard, 'GET', path), { allow: true, kind: 'native-agent-catalog', readCategory: 'nativeAgentCatalog' });
  assert.deepEqual(request(guard, 'GET', '/api/capabilities?kind=agent&orgId=qa-org'), { allow: true, kind: 'native-agent-catalog', readCategory: 'nativeAgentCatalog' });
  assert.deepEqual(guard.summary().readCategories, { nativeAgentCatalog: 2, runtimeMetadata: 0, other: 0 });
  assert.equal(guard.summary().allowedWrites, 1); assert.equal(guard.summary().modelRequests, 0); assert.equal(guard.summary().teachingRequests, 0);
});
test('native agent catalog rejects foreign, missing, extra and duplicate query scope', () => {
  for (const query of ['orgId=foreign&kind=agent', 'orgId=qa-org&kind=skill', 'orgId=qa-org&kind=Agent', 'orgId=qa-org', 'kind=agent', '', 'orgId=qa-org&kind=agent&entry=library', 'orgId=qa-org&kind=agent&orgId=foreign', 'orgId=qa-org&kind=agent&kind=agent']) {
    const { guard, bind } = owned(); bind();
    assert.equal(request(guard, 'GET', `/api/capabilities${query ? `?${query}` : ''}`).allow, false, query);
    assert.deepEqual(guard.summary().readCategories, { nativeAgentCatalog: 0, runtimeMetadata: 0, other: 0 });
  }
});
test('catalog permission does not authorize capability mutations or change safety budgets', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
    const { guard, bind } = owned(); bind();
    assert.equal(request(guard, method, '/api/capabilities?orgId=qa-org&kind=agent', { orgId: 'qa-org', kind: 'agent', op: 'add' }).allow, false);
    assert.equal(guard.summary().allowedWrites, 1); assert.equal(guard.summary().roleWritesAllowed, 0); assert.equal(guard.summary().deletesAllowed, 0);
    assert.equal(guard.summary().modelRequestsAllowed, 1); assert.equal(guard.summary().teachingRequestsAllowed, 6);
  }
});
test('allowed read evidence uses detached closed category counts with no request data', () => {
  const { guard, bind } = owned(); bind();
  request(guard, 'GET', '/api/capabilities?orgId=qa-org&kind=agent');
  assert.equal(request(guard, 'GET', '/api/copilotkit/info').kind, 'read');
  request(guard, 'GET', '/aidt');
  assert.equal(request(guard, 'GET', '/api/copilotkit').allow, false);
  assert.equal(request(guard, 'GET', '/api/copilotkit/info?extra=value').allow, false);
  const counts = guard.summary().readCategories;
  assert.deepEqual(counts, { nativeAgentCatalog: 1, runtimeMetadata: 1, other: 1 });
  assert.equal(/qa-org|https|api|token|secret/.test(JSON.stringify(counts)), false);
  counts.nativeAgentCatalog = 999;
  assert.equal(guard.summary().readCategories.nativeAgentCatalog, 1);
});
test('read diagnostics count classifications without exporting denied query secrets or granting reads', () => {
  const { guard, bind } = owned(); bind();
  const marker = 'synthetic-private-query';
  const denied = request(guard, 'GET', `/api/capabilities?orgId=qa-org&kind=agent&private=${marker}`);
  assert.equal(denied.allow, false); assert.equal(denied.readCategory, 'nativeAgentCatalog');
  request(guard, 'GET', `/api/copilotkit?private=${marker}`);
  request(guard, 'GET', `/api/unknown?private=${marker}`);
  assert.deepEqual(guard.summary().readDenials, { nativeAgentCatalog: 1, runtimeMetadata: 1, other: 1 });
  assert.equal(JSON.stringify(guard.summary()).includes(marker), false);
  assert.equal(JSON.stringify(denied).includes(marker), false);
  const copy = guard.summary().readDenials; copy.other = 999;
  assert.equal(guard.summary().readDenials.other, 1);
});
test('metadata HTTP statuses require observed allowed read responses and reject unknown values', () => {
  const { guard, bind } = owned(); bind();
  const catalog = request(guard, 'GET', '/api/capabilities?orgId=qa-org&kind=agent');
  const runtime = request(guard, 'GET', '/api/copilotkit/info');
  assert.deepEqual(guard.summary().metadataHttpStatuses, { items: [], truncated: false });
  guard.observe(catalog, 200, { private: 'synthetic-response-secret' }); guard.observe(runtime, 503, { private: 'synthetic-response-secret' });
  for (const status of [undefined, null, '200', 'synthetic-status-secret', NaN, Infinity, 99, 600, 200.5]) guard.observe(catalog, status);
  guard.observe({ allow: true, kind: 'read', readCategory: 'synthetic-category-secret' }, 200);
  guard.observe({ allow: false, readCategory: 'nativeAgentCatalog' }, 401);
  assert.deepEqual(guard.summary().metadataHttpStatuses, { items: [{ category: 'nativeAgentCatalog', status: 200 }, { category: 'runtimeMetadata', status: 503 }], truncated: false });
  assert.equal(JSON.stringify(guard.summary()).includes('secret'), false);
  const copy = guard.summary().metadataHttpStatuses; copy.items[0].status = 999; copy.items.push({ category: 'secret', status: 999 });
  assert.equal(guard.summary().metadataHttpStatuses.items.length, 2); assert.equal(guard.summary().metadataHttpStatuses.items[0].status, 200);
});
test('metadata HTTP diagnostics truncate at 128 observed responses without retaining extra fields', () => {
  const { guard, bind } = owned(); bind();
  const catalog = request(guard, 'GET', '/api/capabilities?orgId=qa-org&kind=agent');
  for (let index = 0; index < 128; index++) guard.observe(catalog, 200);
  assert.equal(guard.summary().metadataHttpStatuses.truncated, false);
  guard.observe(catalog, 401); guard.observe(catalog, 599);
  const receipt = guard.summary().metadataHttpStatuses;
  assert.equal(receipt.items.length, 128); assert.equal(receipt.truncated, true);
  assert.deepEqual(Object.keys(receipt.items[0]), ['category', 'status']);
  assert.equal(guard.summary().readCategories.nativeAgentCatalog, 1); // Decisions are not response counts.
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

test('ordinary role is verified before UI creation and lead/admin never count as ordinary', () => {
  for (const role of ['lead', 'admin', 'compliance', undefined]) {
    const guard = createAcceptanceGuard(identity()); guard.armLogin();
    const login = request(guard, 'POST', '/api/auth/login', { email: syntheticLoginValue, password: syntheticLoginValue });
    guard.observe(login, 200, { userId: 'qa-user', orgs: ['qa-org'], sessionToken: 'synthetic-token', expiresAt: '2099-01-01T00:00:00Z' });
    assert.throws(() => guard.verifyOrdinaryIdentity(200, { org: { id: 'qa-org' }, orgRole: role }), /ORDINARY_QA_CONSULTANT_REQUIRED/);
    assert.throws(() => guard.armProjectCreate(), /PROJECT_CREATE_ARM_REJECTED/);
    assert.equal(guard.summary().projectCreates, 0);
  }
});
test('new creation requires the strict atomic profile and short-lived ordinary UI arm', () => {
  for (const patch of [{ profile: undefined }, { profile: 'other' }, { tags: ['workspacex:aidt'] }]) {
    const guard = createAcceptanceGuard(identity()); guard.armLogin();
    const login = request(guard, 'POST', '/api/auth/login', { email: syntheticLoginValue, password: syntheticLoginValue });
    guard.observe(login, 200, { userId: 'qa-user', orgs: ['qa-org'], sessionToken: 'synthetic-token', expiresAt: '2099-01-01T00:00:00Z' });
    guard.verifyOrdinaryIdentity(200, { org: { id: 'qa-org' }, orgRole: 'consultant' }); guard.armProjectCreate();
    assert.equal(request(guard, 'POST', '/api/projects', { orgId: 'qa-org', name: identity().projectName, kind: 'general', blueprintVersionId: null, profile: 'aidt', ...patch }).allow, false);
  }
});

test('course-tag creation allows only the label bound to this ordinary QA run', () => {
  const courseTag = 'QA课程 456-1';
  for (const supplied of [courseTag, '课程 A', undefined]) {
    const guard = createAcceptanceGuard(identity()); guard.armLogin();
    const login = request(guard, 'POST', '/api/auth/login', { email: syntheticLoginValue, password: syntheticLoginValue });
    guard.observe(login, 200, { userId: 'qa-user', orgs: ['qa-org'], sessionToken: 'synthetic-token', expiresAt: '2099-01-01T00:00:00Z' });
    guard.verifyOrdinaryIdentity(200, { org: { id: 'qa-org' }, orgRole: 'consultant' });
    assert.throws(() => guard.armProjectCreate('课程 A'), /PROJECT_CREATE_COURSE_TAG_REJECTED/);
    guard.armProjectCreate(courseTag);
    const body = { orgId: 'qa-org', name: identity().projectName, kind: 'general', blueprintVersionId: null, profile: 'aidt' };
    if (supplied !== undefined) body.courseTag = supplied;
    assert.equal(request(guard, 'POST', '/api/projects', body).allow, supplied === courseTag);
  }
});

test('entry diagnostic allows only login and reads, even if identity is consultant', () => {
  for (const [method, path, body] of [
    ['POST', '/api/projects', { profile: 'aidt' }],
    ['PUT', `/api/projects/${project}/aidt/stages/1`, stageBody()],
    ['POST', '/api/pm-designs', { name: '未命名设计', template: 'ui' }],
    ['PATCH', `/api/projects/${project}/tags`, {}],
  ]) {
    const guard = createAcceptanceGuard({ ...identity(), entryDiagnosticOnly: true }); guard.armLogin();
    const login = request(guard, 'POST', '/api/auth/login', { email: syntheticLoginValue, password: syntheticLoginValue });
    guard.observe(login, 200, { userId: 'qa-user', orgs: ['qa-org'], sessionToken: 'synthetic-token', expiresAt: '2099-01-01T00:00:00Z' });
    assert.deepEqual(guard.readIdentityRole(200, { org: { id: 'qa-org' }, orgRole: 'consultant' }), { orgRole: 'consultant', organizationMatched: true, ordinaryConsultant: true });
    guard.verifyOrdinaryIdentity(200, { org: { id: 'qa-org' }, orgRole: 'consultant' });
    assert.throws(() => guard.armProjectCreate(), /PROJECT_CREATE_ARM_REJECTED/);
    assert.equal(request(guard, method, path, body).code, 'ENTRY_DIAGNOSTIC_READONLY');
    assert.equal(guard.summary().projectCreates, 0);
    assert.equal(guard.summary().modelRequests, 0);
  }
});

test('PNG validation opens its own page and cleans that context without touching the acceptance page', async () => {
  let opened = 0, closed = 0; const bytes = Buffer.alloc(600); Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  const browser = { newContext: async () => ({ route: async () => {}, newPage: async () => { opened++; return { evaluate: async () => ({ width: 1440, height: 40, sampledColors: 20 }) }; }, close: async () => { closed++; } }) };
  assert.equal((await verifyPng(browser, bytes, 24)).height, 40);
  await assert.rejects(verifyPng(browser, bytes), /SCREENSHOT_EMPTY_OR_UNREADABLE/);
  assert.equal(opened, 2); assert.equal(closed, 2);
});

test('homepage image proxy only accepts the two known local images and normal bounded dimensions', () => {
  for (const source of ['/aidt/design-thinking-school.png', '/aidt/workshop-materials.png']) {
    assert.equal(approvedHomeImage(new URL(`https://devapp.boardx.us${source}`)), true);
    assert.equal(approvedHomeImage(new URL(`https://devapp.boardx.us/_next/image?url=${encodeURIComponent(source)}&w=750&q=75`)), true);
  }
  for (const query of ['url=https://evil.example/pixel&w=750&q=75', 'url=/api/private&w=750&q=75', 'url=/aidt/workshop-materials.png&w=999999&q=75', 'url=/aidt/workshop-materials.png&w=750&q=75&extra=1']) assert.equal(approvedHomeImage(new URL(`https://devapp.boardx.us/_next/image?${query}`)), false);
});

test('diagnostic or full pass is revoked if a concurrent request tripped the safety guard', () => {
  for (const executionMode of ['entry-diagnostic-readonly', 'ordinary-ui-first-full']) {
    const report = { executionMode, passed: true, fullAcceptancePassed: true };
    finalizeGuardVerdict(report, { fatal: () => 'ENTRY_DIAGNOSTIC_READONLY' });
    assert.equal(report.passed, false); assert.equal(report.fullAcceptancePassed, false);
    assert.equal(report.failure, 'ENTRY_DIAGNOSTIC_READONLY');
  }
  const ok = { passed: true }; finalizeGuardVerdict(ok, { fatal: () => null }); assert.equal(ok.passed, true);
});


test('private output rejects the legacy collector dot-segment path before creating output, accepts the canonical owned directory', () => {
  const base = mkdtempSync(join(tmpdir(), 'aidt-private-path-'));
  try {
    const runnerTemp = join(base, 'runner-temp'); mkdirSync(runnerTemp, { mode: 0o700 });
    const root = resolve(realpathSync(resolve(runnerTemp, '..')), 'wsx-aidt-acceptance-456-1'); mkdirSync(root, { mode: 0o700 }); chmodSync(root, 0o700);
    writeFileSync(join(root, '.owner'), `456:1:${source}`, { mode: 0o600 });
    const env = { RUNNER_TEMP: runnerTemp, GITHUB_SHA: source, AIDT_ACCEPTANCE_ROOT: `${runnerTemp}/../wsx-aidt-acceptance-456-1` };
    assert.throws(() => privateOutput(env, identity()), /PRIVATE_ROOT_COLLECTOR_MISMATCH/);
    assert.equal(existsSync(join(root, 'output')), false);
    assert.throws(() => privateOutput({ ...env, AIDT_ACCEPTANCE_ROOT: undefined }, identity()), /PRIVATE_ROOT_COLLECTOR_MISMATCH/);
    assert.deepEqual(privateOutput({ ...env, AIDT_ACCEPTANCE_ROOT: root }, identity()), { root, out: join(root, 'output') });
    assert.equal(existsSync(join(root, 'output')), true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('stdout entry evidence retains only observed closed role and booleans, never raw actor or diagnostic fields', () => {
  const privateReport = { actor: { orgRole: 'consultant', orgId: 'private-org', email: 'private-account' }, entryDiagnostic: { completed: true, creationEntryVisible: false, secret: syntheticLoginValue } };
  assert.deepEqual(publicEntryDiagnostic(privateReport), { orgRole: 'consultant', ordinaryQaSuitable: true, creationEntryVisible: false });
  for (const role of ['lead', 'admin', 'compliance']) assert.deepEqual(publicEntryDiagnostic({ actor: { orgRole: role } }), { orgRole: role, ordinaryQaSuitable: false });
  assert.deepEqual(publicEntryDiagnostic({ actor: { orgRole: 'raw-arbitrary-string' }, entryDiagnostic: { completed: true, creationEntryVisible: 'true' } }), {});
  assert.deepEqual(publicEntryDiagnostic({}), {});
});


test('collector uses the physical parent while preserving direct root symlink rejection', () => {
  const base = mkdtempSync(join(tmpdir(), 'aidt-physical-parent-'));
  try {
    const physicalParent = join(realpathSync(base), 'physical'); mkdirSync(physicalParent, { mode: 0o700 });
    mkdirSync(join(physicalParent, 'runner-temp'), { mode: 0o700 });
    const aliasParent = join(base, 'alias'); symlinkSync(physicalParent, aliasParent, 'dir');
    const runnerTemp = join(aliasParent, 'runner-temp');
    const root = join(physicalParent, 'wsx-aidt-acceptance-456-1'); mkdirSync(root, { mode: 0o700 }); chmodSync(root, 0o700);
    writeFileSync(join(root, '.owner'), `456:1:${source}`, { mode: 0o600 });
    const env = { RUNNER_TEMP: runnerTemp, GITHUB_SHA: source };
    for (const unphysical of [join(aliasParent, 'wsx-aidt-acceptance-456-1'), `${runnerTemp}/../wsx-aidt-acceptance-456-1`]) assert.throws(() => privateOutput({ ...env, AIDT_ACCEPTANCE_ROOT: unphysical }, identity()), /PRIVATE_ROOT_COLLECTOR_MISMATCH/);
    assert.equal(existsSync(join(root, 'output')), false);
    assert.deepEqual(privateOutput({ ...env, AIDT_ACCEPTANCE_ROOT: root }, identity()), { root, out: join(root, 'output') });
    rmSync(root, { recursive: true, force: true });
    const target = join(physicalParent, 'other-root'); mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, root, 'dir');
    assert.throws(() => privateOutput({ ...env, AIDT_ACCEPTANCE_ROOT: root }, identity()), /PRIVATE_ROOT_INVALID/);
    assert.equal(existsSync(join(target, 'output')), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});


test('ordinary QA setup is explicit and allowed only for the full live lane, never readonly diagnostic or isolated mode', () => {
  assert.equal(ordinaryQaProvisioningRequested({}, identity()), false);
  assert.equal(ordinaryQaProvisioningRequested({ AIDT_PROVISION_ORDINARY_QA: 'false' }, identity()), false);
  assert.equal(ordinaryQaProvisioningRequested({ AIDT_PROVISION_ORDINARY_QA: 'true', AIDT_LIVE_DEV: 'true' }, identity()), true);
  for (const env of [{ AIDT_PROVISION_ORDINARY_QA: 'yes' }, { AIDT_PROVISION_ORDINARY_QA: 'true' }, { AIDT_PROVISION_ORDINARY_QA: 'true', AIDT_LIVE_DEV: 'false' }]) assert.throws(() => ordinaryQaProvisioningRequested(env, identity()), /QA_IDENTITY_OPT_IN_/);
  assert.throws(() => ordinaryQaProvisioningRequested({ AIDT_PROVISION_ORDINARY_QA: 'true', AIDT_LIVE_DEV: 'true' }, { ...identity(), entryDiagnosticOnly: true }), /QA_IDENTITY_OPT_IN_SCOPE_INVALID/);
});

test('all setup and student secrets remain in memory and are rejected from every shared evidence scanner', () => {
  const guard = sensitiveEvidenceGuard();
  const values = ['unit-admin-identity', 'unit-admin-session', 'unit-invite-token', 'https://qa.invalid/invite/unit-private-link', 'unit-new-identity', 'unit-new-session'];
  for (const value of values) guard.remember(value);
  assert.deepEqual(guard.values(), values);
  assert.equal(JSON.stringify(guard), '{}');
  for (const secret of values) assert.throws(() => guard.assertSafe(`evidence accidentally contains ${secret}`), /SCREENSHOT_SENSITIVE_CONTENT/);
  assert.doesNotThrow(() => guard.assertSafe('safe closed receipt: consultant true'));
  assert.throws(() => guard.remember(''), /QA_SECRET_COLLECTION_BOUND/);
});

test('provisioned student must independently UI-login as the same new consultant and organization, never the admin', () => {
  const setup = { userId: 'new-student', adminUserId: 'setup-admin', orgId: 'same-organization' };
  const current = { actor: setup.userId, org: setup.orgId };
  const me = { org: { id: setup.orgId }, orgRole: 'consultant' };
  assert.equal(assertProvisionedOrdinaryQa(setup, current, 200, me), true);
  for (const actor of [setup.adminUserId, 'different-consultant']) assert.throws(() => assertProvisionedOrdinaryQa(setup, { ...current, actor }, 200, me), /QA_IDENTITY_UI_BINDING_MISMATCH/);
  for (const other of [{ ...me, orgRole: 'admin' }, { ...me, org: { id: 'different-org' } }]) assert.throws(() => assertProvisionedOrdinaryQa(setup, current, 200, other), /QA_IDENTITY_UI_BINDING_MISMATCH/);
  assert.throws(() => assertProvisionedOrdinaryQa({ ...setup, userId: setup.adminUserId }, current, 200, me), /QA_IDENTITY_UI_BINDING_MISMATCH/);
  assert.throws(() => assertProvisionedOrdinaryQa(setup, { ...current, org: 'different-org' }, 200, me), /QA_IDENTITY_UI_BINDING_MISMATCH/);
  assert.throws(() => assertProvisionedOrdinaryQa(setup, current, 403, me), /QA_IDENTITY_UI_BINDING_MISMATCH/);
});

const reviewScope = () => ({ origin: 'https://devapp.boardx.us', projectId: project, stageId: 1, threadId: 'thr_aidt_fixture', skillId: 'skill-fixture', skillVersionId: 'version-fixture', selector: { entityId: '11111111-1111-4111-8111-111111111111' } });
const reviewReceipt = () => ({ projectId: project, stageId: 1, threadId: 'thr_aidt_fixture', runId: 'run-fixture', inputMessageId: 'message-fixture', permissionRequestId: 'request-fixture', toolName: 'confirm_task_intent', knownConfirmTaskIntent: true, argumentFields: [{ name: 'requestId', type: 'string' }, { name: 'understanding', type: 'string' }, { name: 'assumptions', type: 'array-of-strings' }], argumentShapeKnown: true });
const reviewUrl = () => `https://devapp.boardx.us/aidt/${project}?step=1&thread=thr_aidt_fixture&entity=11111111-1111-4111-8111-111111111111&tool=outcome`;
const reviewPin = () => ({ skillId: 'skill-fixture', skillVersionId: 'version-fixture' });

test('pending review receipt is restricted to the actual owned route and mounted teaching pin', () => {
  const value = pendingTeachingReviewReceipt(reviewReceipt(), reviewScope(), reviewUrl(), reviewPin());
  assert.deepEqual(value, reviewReceipt());
  assert.notEqual(value.argumentFields, reviewReceipt().argumentFields);
  for (const url of [reviewUrl().replace(project, 'prj-foreign'), reviewUrl().replace('step=1','step=2'), reviewUrl().replace('thr_aidt_fixture','thr_foreign'), reviewUrl().replace('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'), `${reviewUrl()}&thread=thr_foreign`, reviewUrl().replace('devapp.boardx.us','example.invalid')]) {
    assert.throws(() => pendingTeachingReviewReceipt(reviewReceipt(), reviewScope(), url, reviewPin()), /TOOL_REVIEW_SCOPE_UNVERIFIED/);
  }
  for (const pin of [null, { skillId: 'foreign', skillVersionId: 'version-fixture' }, { skillId: 'skill-fixture', skillVersionId: 'stale' }]) assert.throws(() => pendingTeachingReviewReceipt(reviewReceipt(), reviewScope(), reviewUrl(), pin), /TOOL_REVIEW_SCOPE_UNVERIFIED/);
});

test('receipt projection refuses secret-bearing extra fields and unknown argument names or types', () => {
  const changes = [r => { r.argsSummary = 'synthetic-sensitive-marker'; }, r => { r.argumentFields[0].value = 'synthetic-sensitive-marker'; }, r => { r.argumentFields[0].name = 'unrecognized'; }, r => { r.argumentFields[0].type = 'raw-value'; }, r => { r.argumentFields.push(r.argumentFields[0]); }, r => { r.toolName = 'unknown-tool'; }, r => { r.knownConfirmTaskIntent = false; }, r => { r.projectId = 'foreign'; }];
  for (const change of changes) { const r = reviewReceipt(); change(r); assert.throws(() => pendingTeachingReviewReceipt(r, reviewScope(), reviewUrl(), reviewPin()), /TOOL_REVIEW_RECEIPT_INVALID/); }
});

test('unknown tool/shape is observable as other, never interpreted as permission to act', () => {
  const r = { ...reviewReceipt(), toolName: 'other', knownConfirmTaskIntent: false, argumentFields: [], argumentShapeKnown: false, permissionRequestId: null };
  assert.deepEqual(pendingTeachingReviewReceipt(r, reviewScope(), reviewUrl(), reviewPin()), r);
});

function reviewPage({ nativeCount = 1, dialogCount = 0, openCount = 1, nativeVisible = true, delayedNative = false, openVisible = true, openEnabled = true, captureError } = {}) {
  const events = []; let visible = dialogCount === 1;
  const dialog = { count: async () => dialogCount, isVisible: async () => visible, waitFor: async () => { if (!visible) throw new Error('DIALOG_UNAVAILABLE'); } };
  const open = { count: async () => openCount, isVisible: async () => openVisible, isEnabled: async () => openEnabled, click: async () => { events.push('read-only-open'); dialogCount = 1; visible = true; } };
  const native = { count: async () => nativeCount, waitFor: async () => { if (!nativeVisible) throw new Error('NATIVE_UNAVAILABLE'); if (delayedNative) nativeCount = 1; }, getByRole: (role, options) => { assert.equal(role, 'button'); assert.equal(options.name.test('打开待确认请求'), true); assert.equal(options.name.test('批准并继续'), false); assert.equal(options.name.test('拒绝'), false); return open; } };
  const workspace = { getByTestId: id => { assert.equal(id, 'restored-run-approval'); return native; } };
  const page = { getByTestId: id => { if (id === 'aidt-project-workspace') return workspace; assert.equal(id, 'chat-tool-permission-dialog'); return dialog; }, keyboard: { press: async () => { throw new Error('ESCAPE_MUST_NOT_BE_PRESSED'); } } };
  return { page, events, capture: async () => { events.push('capture-owned-dialog'); if (captureError) throw captureError; } };
}

test('owned native review opens once and captures only the approval dialog without deciding', async () => {
  const f = reviewPage();
  const observed = await observePendingTeachingReview(f);
  assert.deepEqual(f.events, ['read-only-open','capture-owned-dialog']);
  assert.deepEqual(observed, { status: 'captured', code: null, dialogObserved: true, captured: true, domRequestIdentityVerified: false });
});

test('already visible unique native dialog is captured without another open click or Escape', async () => {
  const f = reviewPage({ dialogCount: 1 });
  assert.equal((await observePendingTeachingReview(f)).captured, true);
  assert.deepEqual(f.events, ['capture-owned-dialog']);
});

test('pending native surface may mount after the already observed server status', async () => {
  const f = reviewPage({ nativeCount: 0, delayedNative: true });
  assert.equal((await observePendingTeachingReview(f)).captured, true);
  assert.deepEqual(f.events, ['read-only-open','capture-owned-dialog']);
});

for (const [name, options] of [
  ['missing native owner', { nativeCount: 0 }], ['multiple native owners', { nativeCount: 2 }],
  ['multiple dialogs', { dialogCount: 2 }], ['multiple open triggers', { openCount: 2 }],
  ['missing trigger', { openCount: 0 }], ['hidden trigger', { openVisible: false }],
  ['disabled trigger', { openEnabled: false }], ['native surface not ready', { nativeVisible: false }],
]) test(`pending review capture refuses ${name}`, async () => {
  const f = reviewPage(options), observed = await observePendingTeachingReview(f);
  assert.equal(observed.status, 'not-captured'); assert.equal(observed.captured, false);
  assert.deepEqual(f.events, []);
});

test('privacy scan failure remains a fixed diagnostic without exporting sensitive exception text', async () => {
  const secret = 'fake-private-marker', privacy = sensitiveEvidenceGuard(); privacy.remember(secret);
  const f = reviewPage({ dialogCount: 1 });
  f.capture = async () => privacy.assertSafe(secret);
  const observed = await observePendingTeachingReview(f);
  assert.equal(observed.captured, false); assert.equal(observed.code, 'TOOL_REVIEW_CAPTURE_UNAVAILABLE');
  assert.equal(JSON.stringify(observed).includes(secret), false);
  assert.equal(JSON.stringify(observed).includes('SCREENSHOT_SENSITIVE_CONTENT'), false);
});

const toolReviewEvent = () => ({ event: 'teaching-tool-review-required', runId: 'run-fixture', threadId: 'thr_aidt_fixture', stageId: 1, toolName: 'confirm_task_intent', approvalVisible: true, dialogOpened: true });

test('owned tool diagnostic is privacy checked first and projected beside its unchanged receipt', () => {
  const entry = { receipt: reviewReceipt(), capture: { captured: true } }, before = JSON.stringify(entry.receipt), calls = [];
  assert.equal(recordTeachingEvent(toolReviewEvent(), reviewScope(), [entry], value => { assert.equal(typeof value, 'string'); calls.push('privacy'); }, value => { calls.push('console'); assert.deepEqual(value, toolReviewEvent()); }), true);
  assert.deepEqual(calls, ['privacy','console']);
  assert.equal(JSON.stringify(entry.receipt), before);
  assert.equal(entry.observedToolName, 'confirm_task_intent'); assert.equal(entry.approvalVisible, true); assert.equal(entry.dialogOpened, true);
});

test('tool diagnostics cannot bind another run, thread, stage, project or absent receipt', () => {
  for (const change of [e => { e.runId = 'foreign'; }, e => { e.threadId = 'foreign'; }, e => { e.stageId = 2; }]) {
    const event = toolReviewEvent(); change(event); const entry = { receipt: reviewReceipt() }, before = JSON.stringify(entry), logged = [];
    assert.equal(recordTeachingEvent(event, reviewScope(), [entry], () => {}, value => logged.push(value)), false);
    assert.equal(JSON.stringify(entry), before); assert.equal(logged.length, 1);
  }
  for (const receipt of [undefined, { ...reviewReceipt(), projectId: 'foreign' }, { ...reviewReceipt(), threadId: 'foreign' }, { ...reviewReceipt(), stageId: 2 }]) {
    const entry = { receipt }, before = JSON.stringify(entry);
    assert.equal(recordTeachingEvent(toolReviewEvent(), reviewScope(), [entry], () => {}, () => {}), false);
    assert.equal(JSON.stringify(entry), before);
  }
});

test('a sensitive owned tool event is neither recorded nor emitted', () => {
  const privacy = sensitiveEvidenceGuard(); privacy.remember('private-fixture');
  const entry = { receipt: reviewReceipt() }, before = JSON.stringify(entry), event = { ...toolReviewEvent(), toolName: 'private-fixture' }; let emitted = false;
  assert.throws(() => recordTeachingEvent(event, reviewScope(), [entry], text => privacy.assertSafe(text), () => { emitted = true; }), /SCREENSHOT_SENSITIVE_CONTENT/);
  assert.equal(JSON.stringify(entry), before); assert.equal(emitted, false);
});

test('tool event projection refuses raw fields, non-ASCII/long names and invalid flags before console', () => {
  for (const change of [e => { e.argsSummary = 'must-not-be-exported'; }, e => { e.toolName = '非ASCII'; }, e => { e.toolName = 'x'.repeat(129); }, e => { e.approvalVisible = 'true'; }, e => { e.dialogOpened = true; e.approvalVisible = false; }]) {
    const event = toolReviewEvent(); change(event); const entry = { receipt: reviewReceipt() }, before = JSON.stringify(entry); let emitted = false;
    assert.equal(recordTeachingEvent(event, reviewScope(), [entry], () => {}, () => { emitted = true; }), false);
    assert.equal(JSON.stringify(entry), before); assert.equal(emitted, false);
  }
});

test('a null or unknown valid tool name remains observation only; ordinary events still emit', () => {
  for (const toolName of [null, 'unrecognized.tool']) {
    const entry = { receipt: { ...reviewReceipt(), toolName: 'other', knownConfirmTaskIntent: false } };
    assert.equal(recordTeachingEvent({ ...toolReviewEvent(), toolName }, reviewScope(), [entry], () => {}, () => {}), true);
    assert.equal(entry.observedToolName, toolName); assert.equal(entry.receipt.toolName, 'other'); assert.equal('approved' in entry, false);
  }
  const events = [], entry = { receipt: reviewReceipt() }, before = JSON.stringify(entry);
  assert.equal(recordTeachingEvent({ event: 'send-started', stageId: 1 }, reviewScope(), [entry], () => {}, event => events.push(event)), false);
  assert.equal(JSON.stringify(entry), before); assert.deepEqual(events, [{ event: 'send-started', stageId: 1 }]);
});

test('unreadable approval visibility remains null rather than claiming it was hidden', () => {
  const entry = { receipt: reviewReceipt() };
  assert.equal(recordTeachingEvent({ ...toolReviewEvent(), approvalVisible: null, dialogOpened: null }, reviewScope(), [entry], () => {}, () => {}), true);
  assert.equal(entry.approvalVisible, null); assert.equal(entry.dialogOpened, null);
});
