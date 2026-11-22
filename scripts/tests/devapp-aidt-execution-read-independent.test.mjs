/** Independent request-port regression. Synthetic receipts only; no account, HTTP or model. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { acceptanceIdentity, createAcceptanceGuard } from '../../apps/web/e2e/support/devapp-aidt-acceptance-guard.mjs';
import { createV2AcceptanceGuard } from '../../apps/web/e2e/support/devapp-aidt-v2-request-guard.mjs';
import { createV2VoicePlan } from '../../apps/web/e2e/support/devapp-aidt-v2-plan.mjs';
import { createV2ExecutionLedger } from '../../apps/web/e2e/support/devapp-aidt-v2-profile.mjs';
import { decideOwnedTeachingExecutionRead, identifyOwnedTeachingRun, validateTeachingWire } from '../../apps/web/e2e/support/devapp-aidt-chat-evidence.mjs';

const origin = 'https://devapp.boardx.us', project = 'prj-11111111-1111-4111-8111-111111111111';
const entity = '11111111-1111-4111-8111-222222222222', thread = 'thr_qa_execution';
const path = '/api/agent-runs/backend-owned-run/execution-events';
const fixtureLogin = 'synthetic-unit-only'; // Fake port input; never a real account credential.
const request = (guard, method, path, body) => guard.decide({ url: origin + path, method, body, resourceType: 'fetch' });
function fixture(profile, bind = true) {
  const identity = { ...acceptanceIdentity({ EXPECTED_SOURCE_SHA: 'a'.repeat(40), EXPECTED_RELEASE_TAG: '123-1', GITHUB_RUN_ID: '456', GITHUB_RUN_ATTEMPT: '1' }),
    controlSource: 'b'.repeat(40), teachingSkillNames: ['aidt-understand'] };
  const plan = createV2VoicePlan(); let ledger, runtime;
  const guard = profile === 'baseline' ? createAcceptanceGuard(identity) : createV2AcceptanceGuard(identity,
    { plan, ledger: () => ledger, runtimeScope: () => runtime, now: () => 100 });
  guard.armLogin();
  const login = request(guard, 'POST', '/api/auth/login', { email: fixtureLogin, password: fixtureLogin });
  guard.observe(login, 200, { userId: 'qa-actor', orgs: ['qa-org'], sessionToken: 'synthetic-unit-token', expiresAt: '2099-01-01T00:00:00Z' });
  guard.verifyOrdinaryIdentity(200, { org: { id: 'qa-org' }, orgRole: 'consultant' }); guard.armProjectCreate();
  const create = request(guard, 'POST', '/api/projects', { orgId: 'qa-org', name: identity.projectName, kind: 'general', blueprintVersionId: null, profile: 'aidt' });
  assert.equal(create.allow, true);
  guard.observe(create, 201, { id: project, kind: 'general', status: 'active' });
  guard.bindOwnedProject({ projectId: project, name: identity.projectName }, [{ userId: 'qa-actor', role: 'owner' }]);
  runtime = { source: identity.source, controlSource: identity.controlSource, tag: identity.tag, run: identity.run, attempt: identity.attempt,
    orgId: 'qa-org', actorId: 'qa-actor', orgRole: 'consultant', projectId: project };
  if (profile === 'v2') ledger = createV2ExecutionLedger(plan, runtime, () => 100);
  const arm = (operationId, requestKind) => {
    if (profile === 'v2') guard.armV2Operation({ operationId, kind: 'write', requestKind, stageId: 1, entityRole: 'problem-main', entityId: entity });
  };
  const stage = { projectId: project, stageId: 1, revision: 1, sourceStageRevisions: [], content: { schemaVersion: 1,
    draft: { fields: { ['problemEntity:' + entity]: JSON.stringify({ id: entity, title: 'QA合成问题', archived: false }) }, ideas: [], selectedIdeaId: '' } } };
  if (profile === 'baseline') guard.armStageSave(1, false);
  arm('s1-problem-main-create', 'stage-save');
  const saved = request(guard, 'PUT', `/api/projects/${project}/aidt/stages/1`, { operationId: randomUUID(), expectedRevision: 0, content: stage.content, sourceStageRevisions: [] });
  assert.equal(saved.allow, true, 'normal stage save must be admitted: ' + JSON.stringify(saved)); guard.observe(saved, 200, { stage });
  if (profile === 'v2') guard.registerEntityRole(1, entity, 'problem-main');
  arm('s1-problem-main-entity-thread-initial', 'entity-thread');
  const created = request(guard, 'PUT', `/api/projects/${project}/aidt/stages/1/entities/${entity}/thread`, { purpose: 'stage' });
  assert.equal(created.allow, true, 'normal owned entity thread must be admitted'); guard.observe(created, 200, { threadId: thread });
  guard.observe(request(guard, 'GET', `/api/chat/threads/${thread}`), 200, { thread: { id: thread, projectId: project, archived: false }, capabilities: ['composer.send'] });
  guard.observe(request(guard, 'GET', `/api/threads/${thread}/skill-deviations?projectId=${project}`), 200,
    { temporary: [{ threadId: thread, skillId: 'skill-1', versionId: 'pin-1', removedAt: null }] });
  guard.observe(request(guard, 'GET', '/api/skills?orgId=qa-org&entry=library'), 200,
    { items: [{ platformStableName: 'aidt-understand', skillId: 'skill-1', currentVersionId: 'pin-1', status: '已启用' }] });
  guard.observe(request(guard, 'GET', `/api/chat/threads/${thread}/messages?limit=100`), 200, { messages: [], nextCursor: null });
  const scope = { origin, projectId: project, stageId: 1, threadId: thread, actorId: 'qa-actor', prompt: 'QA合成软件验证，只请求学生阶段引导。',
    skillId: 'skill-1', skillVersionId: 'pin-1', knownMessages: [],
    selector: { schemaVersion: 1, purpose: 'stage', projectId: project, stageId: 1, entityId: entity, stageRevisions: [{ stageId: 1, revision: 1 }] } };
  const wire = { threadId: 'sdk-thread', runId: 'sdk-correlation', messages: [{ id: 'client-owned', role: 'user', content: scope.prompt }],
    tools: [], context: [], state: {}, forwardedProps: { chatThreadId: thread, clientMessageId: 'client-owned', aidtContext: scope.selector } };
  guard.armTeachingSend(scope);
  assert.equal(request(guard, 'POST', '/api/copilotkit/agent/default/run', wire).allow, true);
  const canonical = { messages: [{ id: 'human-owned', authorKind: 'human', authorId: scope.actorId, text: scope.prompt,
    clientMessageId: 'client-owned', agentRunId: 'backend-owned-run' }], nextCursor: null };
  if (bind) guard.observe(request(guard, 'GET', `/api/chat/threads/${thread}/messages?limit=100`), 200, canonical);
  return { guard, scope, wire, canonical };
}

for (const profile of ['baseline', 'v2']) {
  test(`${profile}: canonical owned run permits initial and later trace pages without changing write budgets`, () => {
    const { guard } = fixture(profile), before = guard.summary();
    for (const cursor of [-1, 0, 24, Number.MAX_SAFE_INTEGER]) {
      const d = request(guard, 'GET', path + '?afterSeq=' + cursor);
      assert.equal(d.allow, true); assert.equal(d.kind, 'owned-teaching-execution-read');
      assert.equal(d.runId, 'backend-owned-run'); assert.equal(d.afterSeq, cursor);
      assert.doesNotThrow(() => guard.observe(d, 200, { events: [], nextSeq: null }));
    }
    for (const key of ['allowedWrites', 'teachingRequests', 'modelRequests', 'roleWritesAllowed', 'deletesAllowed', 'ownedTeachingRunCount'])
      assert.equal(guard.summary()[key], before[key], key);
  });
  test(`${profile}: URL or SDK run cannot authorize trace access before canonical human binding`, () => {
    const { guard, canonical } = fixture(profile, false);
    assert.equal(request(guard, 'GET', path + '?afterSeq=-1').allow, false);
    assert.equal(request(guard, 'GET', '/api/agent-runs/sdk-correlation/execution-events?afterSeq=-1').allow, false);
    guard.observe(request(guard, 'GET', `/api/chat/threads/${thread}/messages?limit=100`), 200, canonical);
    assert.equal(request(guard, 'GET', path + '?afterSeq=-1').allow, true);
    assert.equal(request(guard, 'GET', '/api/agent-runs/unrelated-run/execution-events?afterSeq=-1').allow, false);
  });
  for (const query of ['', '?afterSeq=', '?afterSeq=-2', '?afterSeq=1.2', '?afterSeq=1e2', '?afterSeq=01', '?afterSeq=+1', '?afterSeq=9007199254740992',
    '?afterSeq=-1&afterSeq=0', '?afterSeq=-1&limit=100', '?afterSeq=%2D1', '?afterSeq=-1#other']) {
    test(`${profile}: reject malformed or expanded cursor ${query}`, () => {
      const { guard } = fixture(profile); assert.equal(request(guard, 'GET', path + query).allow, false);
    });
  }
  test(`${profile}: wrong origin, encoded run separator and mutating verbs stay denied`, () => {
    for (const [method, url] of [['GET', 'https://outside.invalid' + path + '?afterSeq=-1'], ['GET', origin + '/api/agent-runs/backend-owned-run%2Fother/execution-events?afterSeq=-1'],
      ['POST', origin + path + '?afterSeq=-1'], ['PUT', origin + path + '?afterSeq=-1']]) {
      const { guard } = fixture(profile); assert.equal(guard.decide({ method, url, resourceType: 'fetch' }).allow, false);
    }
  });
}
test('shared evidence policy rejects borrowed actor, org, project, thread or changed accepted receipt', () => {
  const { scope, wire: raw, canonical } = fixture('baseline');
  const wire = validateTeachingWire({ method: 'POST', url: origin + '/api/copilotkit/agent/default/run', body: raw }, scope);
  const accepted = identifyOwnedTeachingRun(canonical, scope, wire);
  const make = () => ({ actorId: scope.actorId, orgId: 'qa-org', projectId: project, threads: new Set([thread]),
    ownedRuns: new Set([accepted.runId]), teachingLedger: new Map([['entry', { scope: { ...scope, orgId: 'qa-org' }, wire, accepted }]]) });
  assert.equal(decideOwnedTeachingExecutionRead(new URL(origin + path + '?afterSeq=-1'), 'GET', make()).allow, true);
  for (const mutate of [f => { f.actorId = 'other-actor'; }, f => { f.orgId = 'other-org'; }, f => { f.projectId = 'other-project'; },
    f => { f.threads.clear(); }, f => { f.teachingLedger.get('entry').scope = { ...scope, projectId: 'other-project' }; },
    f => { f.teachingLedger.set('duplicate', { ...f.teachingLedger.get('entry') }); },
    f => { f.teachingLedger.get('entry').accepted = { ...accepted, inputMessageId: '' }; }]) {
    const facts = make(); mutate(facts);
    assert.equal(decideOwnedTeachingExecutionRead(new URL(origin + path + '?afterSeq=-1'), 'GET', facts).allow, false);
  }
});
