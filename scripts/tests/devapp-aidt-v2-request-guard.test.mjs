import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createV2AcceptanceGuard, assertV2AsrOnceEvidence, V2_NATIVE_ACTION_STAGES, V2_REQUEST_KINDS } from '../../apps/web/e2e/support/devapp-aidt-v2-request-guard.mjs';
import { acceptanceIdentity } from '../../apps/web/e2e/support/devapp-aidt-acceptance-guard.mjs';
import { createV2VoicePlan } from '../../apps/web/e2e/support/devapp-aidt-v2-plan.mjs';
import { createV2ExecutionLedger } from '../../apps/web/e2e/support/devapp-aidt-v2-profile.mjs';

const project = 'prj-11111111-1111-4111-8111-111111111111';
const problem = '11111111-1111-4111-8111-222222222222';
const origin = 'https://devapp.boardx.us';
const fakeLoginValue = 'synthetic-unit-fixture-not-an-account';
const request = (guard, method, path, body) => guard.decide({ url: origin + path, method, body, resourceType: 'fetch' });
function setup({ plan = createV2VoicePlan(), mutableScope } = {}) {
  let clock = 100, ledger, scope;
  const identity = { ...acceptanceIdentity({ EXPECTED_SOURCE_SHA: 'a'.repeat(40), EXPECTED_RELEASE_TAG: '123-1', GITHUB_RUN_ID: '456', GITHUB_RUN_ATTEMPT: '1' }), controlSource: 'b'.repeat(40) };
  const guard = createV2AcceptanceGuard(identity, { plan, ledger: () => ledger, runtimeScope: () => mutableScope?.(scope) ?? scope, now: () => clock });
  guard.armLogin();
  const login = request(guard, 'POST', '/api/auth/login', { email: fakeLoginValue, password: fakeLoginValue });
  assert.equal(login.allow, true);
  guard.observe(login, 200, { userId: 'qa-user', orgs: ['qa-org'], sessionToken: 'synthetic-unit-token', expiresAt: '2099-01-01T00:00:00Z' });
  guard.verifyOrdinaryIdentity(200, { org: { id: 'qa-org' }, orgRole: 'consultant' });
  guard.armProjectCreate();
  const create = request(guard, 'POST', '/api/projects', { orgId: 'qa-org', name: identity.projectName, kind: 'general', blueprintVersionId: null, profile: 'aidt' });
  assert.equal(create.allow, true);
  guard.observe(create, 201, { id: project, kind: 'general', status: 'active', provenanceEventId: 'qa-event' });
  guard.bindOwnedProject({ projectId: project, name: identity.projectName }, [{ userId: 'qa-user', role: 'owner' }]);
  scope = { source: identity.source, controlSource: identity.controlSource, tag: identity.tag, run: identity.run, attempt: identity.attempt,
    orgId: 'qa-org', actorId: 'qa-user', orgRole: 'consultant', projectId: project };
  ledger = createV2ExecutionLedger(plan, scope, () => clock);
  const operation = plan.operations.find(row => row.stage === 1 && row.entityRole === 'problem-main' && row.kind === 'write' && row.id.endsWith('-create'));
  assert.ok(operation);
  const arm = (patch = {}) => guard.armV2Operation({ operationId: operation.id, kind: 'write', requestKind: 'stage-save', stageId: 1, entityRole: operation.entityRole, entityId: problem, ...patch });
  return { guard, plan, operation, arm, ledger, tick: value => { clock = value; } };
}
const body = fields => ({ operationId: randomUUID(), expectedRevision: 0, sourceStageRevisions: [], content: { schemaVersion: 1,
  draft: { fields: fields ?? { ['problemEntity:' + problem]: JSON.stringify({ id: problem, title: 'QA合成问题', archived: false }) }, ideas: [], selectedIdeaId: '' } } });

test('the new profile keeps baseline limits and has no wildcard native action prefix', () => {
  const baseline = readFileSync(new URL('../../apps/web/e2e/support/devapp-aidt-acceptance-guard.mjs', import.meta.url), 'utf8');
  assert.match(baseline, /export const TEACHING_TURN_LIMIT = 44;/);
  assert.match(baseline, /const WRITE_LIMIT = 128 \+ 9 \* 15;/);
  assert.equal(Object.keys(V2_NATIVE_ACTION_STAGES).length, 7);
  assert.equal(V2_NATIVE_ACTION_STAGES['arbitrary-prefix'], undefined);
  assert.ok(V2_REQUEST_KINDS.includes('chat-audio-upload'));
});
test('a missing or changed plan cannot become request authority', () => {
  assert.throws(() => createV2AcceptanceGuard({}, {}), /V2_PLAN_REQUIRED/);
  const plan = structuredClone(createV2VoicePlan()); plan.limits.physicalMutationRequests += 1;
  assert.throws(() => setup({ plan }), /V2_PLAN_CHANGED/);
});
test('bootstrap finishes before a project-bound ledger exists', () => {
  const { guard } = setup();
  assert.equal(guard.identity().ordinaryVerified, true);
  assert.equal(guard.identity().projectId, project);
  assert.equal(guard.summary().loginRequests, 1);
  assert.equal(guard.summary().projectCreates, 1);
});
test('unarmed writes never fall back to baseline stage arming', () => {
  const { guard } = setup(); guard.armStageSave(1, false);
  assert.equal(request(guard, 'PUT', `/api/projects/${project}/aidt/stages/1`, body()).allow, false);
  assert.equal(guard.fatal(), 'V2_EXACT_REQUEST_SLOT_REQUIRED');
});
test('one exact stage slot records a real response once and refuses replay', () => {
  const { guard, arm, ledger, operation } = setup(); arm();
  const input = body(), decision = request(guard, 'PUT', `/api/projects/${project}/aidt/stages/1`, input);
  assert.equal(decision.allow, true);
  guard.observe(decision, 200, { stage: { projectId: project, stageId: 1, revision: 1, content: input.content, sourceStageRevisions: [] } });
  assert.equal(ledger.summary().operations.find(row => row.id === operation.id).status, 'SUCCEEDED');
  assert.throws(() => arm(), /V2_REQUEST_SLOT_INVALID/);
  assert.throws(() => guard.observe(decision, 200, {}), /V2_REQUEST_RESPONSE_REPLAYED/);
});
test('wrong actor, project or controller identity cannot arm a planned slot', () => {
  for (const changed of [{ actorId: 'other' }, { projectId: 'prj-22222222-2222-4222-8222-222222222222' }, { controlSource: 'c'.repeat(40) }, { orgRole: 'admin' }]) {
    const { arm } = setup({ mutableScope: scope => ({ ...scope, ...changed }) });
    assert.throws(() => arm(), /V2_RUNTIME_SCOPE_UNVERIFIED/);
  }
});
test('expired slots and wrong stage IDs do not authorize a nearby route', () => {
  const expired = setup(); expired.arm(); expired.tick(20000);
  assert.equal(request(expired.guard, 'PUT', `/api/projects/${project}/aidt/stages/1`, body()).allow, false);
  const wrong = setup(); wrong.arm();
  assert.equal(request(wrong.guard, 'PUT', `/api/projects/${project}/aidt/stages/2`, body()).allow, false);
  assert.equal(wrong.guard.fatal(), 'V2_REQUEST_ENTITY_MISMATCH');
});
test('nested foreign project references are rejected before the stage write', () => {
  const { guard, arm } = setup(); arm();
  const decision = request(guard, 'PUT', `/api/projects/${project}/aidt/stages/1`, body({ hostile: JSON.stringify({ projectId: 'foreign-project' }) }));
  assert.equal(decision.allow, false); assert.equal(guard.fatal(), 'FOREIGN_PROJECT_REFERENCE');
});
test('a server error locks a sent mutation instead of replaying an unknown outcome', () => {
  const { guard, arm, ledger, operation } = setup(); arm();
  const decision = request(guard, 'PUT', `/api/projects/${project}/aidt/stages/1`, body());
  assert.equal(decision.allow, true); guard.observe(decision, 503, { error: 'synthetic outage' });
  assert.equal(guard.fatal(), 'V2_UNKNOWN_MUTATION_OUTCOME');
  assert.equal(ledger.summary().operations.find(row => row.id === operation.id).status, 'UNKNOWN');
  assert.equal(ledger.stopped(), 'V2_UNKNOWN_MUTATION_OUTCOME');
});
test('an unknown write or an arbitrary ASR / permission route stays blocked', () => {
  for (const path of ['/api/chat/asr-draft', '/api/recording/asr', '/api/admin/roles', '/internal/audio-transcribe']) {
    const { guard, arm } = setup(); arm(); assert.equal(request(guard, 'POST', path, {}).allow, false);
  }
});

// These definitions exercise slot selection only. Missing real thread/pin facts
// must still prevent teaching authorization after the exact slot is claimed.
function normalTeachingSlotFixture(stageId, role, flags = {}) {
  const { guard, ledger, plan } = setup();
  const entityId = '11111111-1111-4111-8111-333333333333';
  const fields = stageId === 6 ? { ['testGroup:' + entityId]: JSON.stringify({ id: entityId, method: 'interview' }) } : {};
  const read = request(guard, 'GET', `/api/projects/${project}/aidt/stages/${stageId}`);
  assert.equal(read.allow, true);
  guard.observe(read, 200, { stage: { projectId: project, stageId, revision: 1,
    content: { schemaVersion: 1, draft: { fields, ideas: stageId === 5 ? [{ id: entityId, title: '合成来源坐标', description: '' }] : [], selectedIdeaId: '' } }, sourceStageRevisions: [] } });
  if (role) guard.registerEntityRole(stageId, entityId, role);
  const scope = { origin, projectId: project, stageId, entityId, threadId: 'thr-qa-missing-runtime-facts', actorId: 'qa-user',
    skillId: 'qa-skill', skillVersionId: 'qa-skill-version', prompt: '合成 QA 学生输入，仅作请求槽位的独立定义。', knownMessages: [],
    selector: { schemaVersion: 1, purpose: 'stage', projectId: project, stageId, entityId, stageRevisions: [{ stageId, revision: 1 }] }, ...flags };
  return { guard, ledger, plan, scope };
}
test('S5 initial and S6 explicit task/result map only to their own named slot and retain runtime rejection', () => {
  for (const row of [
    { stage: 5, role: 'prototype-single', flags: {}, suffix: 'student-initial' },
    { stage: 5, role: 'prototype-three', flags: {}, suffix: 'student-initial' },
    { stage: 6, role: 'test-offline', flags: { testPlan: true }, suffix: 'student-task-initial' },
    { stage: 6, role: 'test-survey', flags: { testPlan: true }, suffix: 'student-task-initial' },
    { stage: 6, role: 'test-virtual', flags: {}, suffix: 'student-result-review' },
    { stage: 6, role: 'test-offline', flags: { testPlan: false }, suffix: 'student-result-review' },
  ]) {
    const { guard, ledger, plan, scope } = normalTeachingSlotFixture(row.stage, row.role, row.flags);
    assert.throws(() => guard.armTeachingSend(scope), /TEACHING_SCOPE_NOT_VERIFIED/);
    const expected = plan.operations.find(op => op.stage === row.stage && op.kind === 'teaching' && op.entityRole === row.role && op.id.endsWith('-' + row.suffix));
    assert.ok(expected);
    assert.equal(ledger.summary().operations.find(op => op.id === expected.id).status, 'CLAIMED');
    assert.equal(ledger.summary().operations.filter(op => op.status === 'CLAIMED').length, 1);
    assert.equal(guard.nativeTeachingState(expected.id), null);
  }
});
test('a missing S5 ownership role cannot borrow another prototype initial slot', () => {
  const { guard, ledger, scope } = normalTeachingSlotFixture(5, null);
  assert.throws(() => guard.armTeachingSend(scope), /V2_TEACHING_SLOT_REQUIRED/);
  assert.equal(ledger.summary().operations.some(op => op.status === 'CLAIMED'), false);
});
test('a truthy non-boolean testPlan does not select the S6 task-initial slot', () => {
  const { guard, ledger, plan, scope } = normalTeachingSlotFixture(6, 'test-offline', { testPlan: 'true' });
  assert.throws(() => guard.armTeachingSend(scope), /TEACHING_SCOPE_NOT_VERIFIED/);
  const task = plan.operations.find(op => op.stage === 6 && op.entityRole === 'test-offline' && op.id.endsWith('-student-task-initial'));
  assert.equal(ledger.summary().operations.find(op => op.id === task.id).status, 'NOT_RUN');
});

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function asrOnceFixture(toolName = 'wx_audio_transcribe', stageId = 2) {
  const sourceSha256 = 'a'.repeat(64), requestId = '11111111-1111-4111-8111-444444444444';
  const entityRole = stageId === 2 ? 'source-interview' : 'test-offline', entityId = problem;
  const args = toolName === 'wx_audio_transcribe' ? {attachmentId:'attachment-qa-audio'}
    : {workspacePath:'/workspace/transcribed-' + 'c'.repeat(64) + '.json',title:`aidt-asr-${requestId}.json`,mediaType:'application/json',idempotencyKey:'qa-asr-publish'};
  const permission = {runId:'run-qa-asr',permissionRequestId:'11111111-1111-4111-8111-555555555555',toolName,argsSha256:digest(args)};
  const review = {reviewed:true,reviewerKind:'agent',projectId:project,entityId,threadId:'thr-qa-asr',runId:permission.runId,
    inputMessageId:'message-qa-audio',permissionRequestId:permission.permissionRequestId,toolName,argsSha256:permission.argsSha256,
    sourceSha256,reviewedAtMs:100,expiresAtMs:1100,nonce:'qa_nonce_fresh_12345678'};
  permission.review = review;
  const receipt = 'audio-transcription-receipt:v1 ' + JSON.stringify({status:'succeeded',workspacePath:args.workspacePath ?? '/workspace/transcribed-' + 'c'.repeat(64) + '.json',sha256:'d'.repeat(64),sourceHash:sourceSha256});
  const entry = {ticket:{requestKind:'asr-file',entityRole},scope:{stageId,projectId:project,actorId:'qa-user',threadId:'thr-qa-asr',selector:{entityId}},
    accepted:{runId:permission.runId,inputMessageId:'message-qa-audio'},asrAudio:{attachmentId:'attachment-qa-audio',sourceSha256,requestId}};
  const observed = {at:150,run:{runId:permission.runId,threadId:'thr-qa-asr',inputMessageId:'message-qa-audio',status:'awaiting_tool_permission',
    pendingApproval:{permissionRequestId:permission.permissionRequestId,toolName,interrupt:{toolName,args}},
    steps:[{kind:'tool_call',status:'succeeded',toolName:'wx_audio_transcribe',toolArgsSummary:JSON.stringify({attachmentId:'attachment-qa-audio'}),toolResultSummary:receipt,outputDigest:createHash('sha256').update(receipt).digest('hex')}]}};
  return {stageId,entityRole,entityId,projectId:project,actorId:'qa-user',permission,entry,observed,review,now:200};
}
test('known ASR once evidence binds each of four exact slots without granting a request', () => {
  for (const stage of [2,6]) for (const tool of ['wx_audio_transcribe','wx_artifact_publish']) {
    const facts = asrOnceFixture(tool,stage), expected = `s${stage}-${facts.entityRole}-asr-${tool === 'wx_audio_transcribe' ? 'audio' : 'publish'}-permission-once`;
    assert.equal(assertV2AsrOnceEvidence(facts).operationId,expected);
  }
});
test('ASR once evidence rejects stale, foreign, missing, changed and broad-approval facts', () => {
  const changes = [
    value => {value.permission.toolName='unknown_tool';},
    value => {value.entry.ticket.requestKind='teaching-send';},
    value => {value.entry.accepted.runId='another-run';},
    value => {value.actorId='another-actor';},
    value => {value.entityId='11111111-1111-4111-8111-666666666666';},
    value => {value.entityRole='source-observation';},
    value => {value.observed.at=-20000;},
    value => {value.observed.run.status='running';},
    value => {value.observed.run.pendingApproval.permissionRequestId=randomUUID();},
    value => {value.observed.run.pendingApproval.interrupt.args.attachmentId='another-audio';},
    value => {value.review.reviewed=false;},
    value => {value.review.reviewerKind='human';},
    value => {value.review.sourceSha256='b'.repeat(64);},
    value => {value.review.expiresAtMs=199;},
    value => {value.review.expiresAtMs=300000;},
    value => {value.review.nonce='';},
    value => {value.permission.decision='forever';},
    value => {delete value.permission.review;},
  ];
  for(const change of changes){const facts=asrOnceFixture();change(facts);assert.throws(()=>assertV2AsrOnceEvidence(facts),/V2_ASR_PERMISSION_UNVERIFIED/);}
});
test('publish approval requires the successful exact audio receipt and original JSON path', () => {
  const changes = [
    value => {value.observed.run.steps=[];},
    value => {value.observed.run.steps[0].outputDigest='e'.repeat(64);},
    value => {value.observed.run.steps[0].toolResultSummary='audio-transcription-receipt:v1 {}';},
    value => {value.observed.run.pendingApproval.interrupt.args.workspacePath='/workspace/unrelated.json';},
    value => {value.observed.run.pendingApproval.interrupt.args.title='unrelated.json';},
    value => {value.observed.run.pendingApproval.interrupt.args.mediaType='text/html';},
    value => {delete value.observed.run.pendingApproval.interrupt.args.idempotencyKey;},
  ];
  for(const change of changes){const facts=asrOnceFixture('wx_artifact_publish');change(facts);assert.throws(()=>assertV2AsrOnceEvidence(facts),/V2_ASR_PERMISSION_UNVERIFIED/);}
});
test('permission routes remain rejected without an armed, current, reviewed owned ASR run', () => {
  for(const decision of ['once','run','forever','always']) {
    const {guard}=setup();
    assert.equal(request(guard,'POST','/api/agent-runs/run-qa-asr/permission-requests/11111111-1111-4111-8111-555555555555/decision',{decision}).allow,false);
  }
});


test('V2 catalog preserves only the actual run-owned native row after repeated QA', async () => {
  const { visibleAidtQaProjects } = await import('../../apps/web/e2e/support/devapp-aidt-acceptance.mjs');
  const { guard } = setup();
  const decision = request(guard, 'GET', '/api/projects?orgId=qa-org');
  assert.equal(decision.allow, true);
  assert.equal(decision.kind, 'qa-project-catalog');
  assert.equal(decision.projectId, project);
  const prior = { id: 'prj-22222222-2222-4222-8222-222222222222', name: 'previous synthetic QA' };
  const current = { id: project, name: 'actual native current row', tags: ['workspacex:aidt'] };
  assert.deepEqual(visibleAidtQaProjects([prior, current], decision.projectId), [current]);
  assert.deepEqual(visibleAidtQaProjects([prior], decision.projectId), []);
  assert.throws(() => visibleAidtQaProjects([current, current], decision.projectId), /QA_PROJECT_CATALOG_INVALID/);
  assert.equal(request(guard, 'GET', `/api/projects/${prior.id}/collaborators`).allow, false);
  assert.equal(request(guard, 'GET', `/api/projects/${project}/collaborators`).allow, true);
});

test('V2 catalog cannot invent a project before ordinary native creation', async () => {
  const { visibleAidtQaProjects } = await import('../../apps/web/e2e/support/devapp-aidt-acceptance.mjs');
  const identity = { ...acceptanceIdentity({ EXPECTED_SOURCE_SHA: 'a'.repeat(40), EXPECTED_RELEASE_TAG: '123-1', GITHUB_RUN_ID: '456', GITHUB_RUN_ATTEMPT: '1' }), controlSource: 'b'.repeat(40) };
  const guard = createV2AcceptanceGuard(identity, { plan: createV2VoicePlan(), ledger: () => undefined, runtimeScope: () => undefined, now: () => 100 });
  assert.equal(request(guard, 'GET', '/api/projects?orgId=qa-org').allow, false);
  guard.armLogin();
  const login = request(guard, 'POST', '/api/auth/login', { email: fakeLoginValue, password: fakeLoginValue });
  guard.observe(login, 200, { userId: 'qa-user', orgs: ['qa-org'], sessionToken: 'synthetic-unit-token', expiresAt: '2099-01-01T00:00:00Z' });
  guard.verifyOrdinaryIdentity(200, { org: { id: 'qa-org' }, orgRole: 'consultant' });
  const decision = request(guard, 'GET', '/api/projects?orgId=qa-org');
  assert.equal(decision.kind, 'qa-project-catalog');
  assert.equal(decision.projectId, null);
  assert.deepEqual(visibleAidtQaProjects([{ id: project, name: 'old existing project' }], decision.projectId), []);
  assert.equal(guard.summary().projectCreates, 0);
});

test('V2 catalog keeps exact organization query and foreign roster restrictions', () => {
  for (const path of ['/api/projects?orgId=other', '/api/projects?orgId=qa-org&extra=x', '/api/projects?orgId=qa-org&orgId=qa-org', '/api/projects']) {
    const { guard } = setup();
    assert.equal(request(guard, 'GET', path).allow, false, path);
  }
  const { guard } = setup();
  assert.equal(request(guard, 'GET', '/api/projects?orgId=qa-org').readCategory, 'other');
  assert.equal(request(guard, 'GET', '/api/projects/prj-22222222-2222-4222-8222-222222222222/collaborators').allow, false);
});
