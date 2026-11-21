import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptanceIdentity, createAcceptanceGuard } from '../../apps/web/e2e/support/devapp-aidt-acceptance-guard.mjs';
const origin = 'https://devapp.boardx.us', project = 'prj-11111111-1111-4111-8111-111111111111';
const fixtureLogin = 'unit-synthetic-only';
const request = (guard, method, path, body) => guard.decide({ url: origin + path, method, body, resourceType: 'fetch' });
function fixture() {
  const identity = { ...acceptanceIdentity({ EXPECTED_SOURCE_SHA: 'a'.repeat(40), EXPECTED_RELEASE_TAG: '123-1', GITHUB_RUN_ID: '456', GITHUB_RUN_ATTEMPT: '1' }), teachingSkillNames: Array.from({ length: 6 }, (_, index) => `teaching-stage-${index + 1}`) };
  const guard = createAcceptanceGuard(identity);
  guard.armLogin(); const login = request(guard, 'POST', '/api/auth/login', { email: fixtureLogin, password: fixtureLogin });
  guard.observe(login, 200, { userId: 'qa-actor', orgs: ['qa-org'], sessionToken: 'synthetic-token', expiresAt: '2099-01-01T00:00:00Z' });
  guard.verifyOrdinaryIdentity(200, { org: { id: 'qa-org' }, orgRole: 'consultant' }); guard.armProjectCreate();
  const created = request(guard, 'POST', '/api/projects', { orgId: 'qa-org', name: identity.projectName, kind: 'general', blueprintVersionId: null, profile: 'aidt' });
  guard.observe(created, 201, { id: project, kind: 'general', status: 'active' });
  guard.bindOwnedProject({ projectId: project, name: identity.projectName }, [{ userId: 'qa-actor', role: 'owner' }]);
  const catalog = request(guard, 'GET', '/api/skills?orgId=qa-org&entry=library');
  guard.observe(catalog, 200, { items: identity.teachingSkillNames.map((platformStableName, index) => ({ platformStableName, skillId: `skill-${index+1}`, currentVersionId: `pin-${index+1}`, status: '已启用' })) });
  return guard;
}
function teaching(guard, stageId = 1, suffix = stageId) {
  const threadId = `thr_qa-${suffix}`, entityId = `entity-${suffix}`;
  const created = request(guard, 'PUT', `/api/projects/${project}/aidt/stages/${stageId}/entities/${entityId}/thread`, { purpose: 'stage' });
  guard.observe(created, 200, { threadId });
  guard.observe(request(guard, 'GET', `/api/chat/threads/${threadId}`), 200, { thread: { id: threadId, projectId: project, archived: false }, capabilities: ['composer.send'] });
  guard.observe(request(guard, 'GET', `/api/threads/${threadId}/skill-deviations?projectId=${project}`), 200, { temporary: [{ threadId, skillId: `skill-${stageId}`, versionId: `pin-${stageId}`, removedAt: null }] });
  guard.observe(request(guard, 'GET', `/api/projects/${project}/aidt/stages/${stageId}`), 200, { stage: { projectId: project, stageId, revision: 2, content: { draft: { fields: {} } } } });
  guard.observe(request(guard, 'GET', `/api/chat/threads/${threadId}/messages?limit=100`), 200, { messages: [], nextCursor: null });
  const scope = { origin, projectId: project, stageId, threadId, actorId: 'qa-actor', prompt: `QA合成第${stageId}步，仅文字追问，不替学生保存。`, selector: { schemaVersion: 1, purpose: 'stage', projectId: project, stageId, entityId, stageRevisions: [{ stageId, revision: 2 }] }, skillId: `skill-${stageId}`, skillVersionId: `pin-${stageId}`, knownMessages: [] };
  const wire = { threadId: `sdk-thread-${stageId}`, runId: `sdk-run-${stageId}`, messages: [{ id: `client-${stageId}`, role: 'user', content: scope.prompt }], state: {}, tools: [], context: [], forwardedProps: { chatThreadId: threadId, clientMessageId: `client-${stageId}`, aidtContext: scope.selector } };
  return { scope, wire };
}
test('teaching send is one normal UI intent with exact owned thread, entity, stage, saved revision and actual pin', () => {
  const guard = fixture(), { scope, wire } = teaching(guard);
  assert.deepEqual(guard.teachingPin(1, scope.threadId), { skillId: 'skill-1', skillVersionId: 'pin-1' });
  guard.armTeachingSend(scope);
  assert.equal(request(guard, 'POST', '/api/copilotkit/agent/default/run', wire).allow, true);
  assert.equal(guard.summary().teachingRequests, 1);
  assert.throws(() => guard.armTeachingSend(scope), /TEACHING_SCOPE_NOT_VERIFIED/);
});
test('SDK/SSE run IDs never authorize a receipt until exact QA durable human message links the backend run', () => {
  const guard = fixture(), { scope, wire } = teaching(guard); guard.armTeachingSend(scope);
  request(guard, 'POST', '/api/copilotkit/agent/default/run', wire);
  assert.equal(request(guard, 'GET', '/api/agent-runs/sdk-run-1/aidt-context').allow, false);
  const messages = request(guard, 'GET', `/api/chat/threads/${scope.threadId}/messages?limit=100`);
  guard.observe(messages, 200, { messages: [{ id: 'human-1', authorKind: 'human', authorId: 'qa-actor', text: scope.prompt, clientMessageId: 'client-1', agentRunId: 'backend-run-1' }], nextCursor: null });
  assert.equal(request(guard, 'GET', '/api/agent-runs/backend-run-1').allow, true);
  assert.equal(request(guard, 'GET', '/api/agent-runs/backend-run-1/aidt-context').allow, true);
  assert.equal(request(guard, 'GET', '/api/agent-runs/another-users-run').allow, false);
});
test('another author, project/entity/version or wrong stage pin cannot create a teaching allowance', () => {
  for (const mutate of [s => { s.actorId='other'; }, s => { s.projectId='foreign'; s.selector.projectId='foreign'; }, s => { s.selector.entityId='foreign'; }, s => { s.selector.stageRevisions[0].revision=1; }, s => { s.skillVersionId='other-pin'; }]) {
    const guard = fixture(), { scope } = teaching(guard); mutate(scope);
    assert.throws(() => guard.armTeachingSend(scope)); assert.equal(guard.summary().teachingRequests, 0);
  }
  const guard = fixture(), { scope, wire } = teaching(guard); guard.armTeachingSend(scope); request(guard,'POST','/api/copilotkit/agent/default/run',wire);
  const messages = request(guard,'GET',`/api/chat/threads/${scope.threadId}/messages?limit=100`);
  assert.throws(() => guard.observe(messages,200,{messages:[{id:'another-human',authorKind:'human',authorId:'not-qa',text:scope.prompt,clientMessageId:'client-1',agentRunId:'private-run'}],nextCursor:null}), /TEACHING_ACCEPTANCE_MISMATCH/);
  assert.equal(request(guard,'GET','/api/agent-runs/private-run').allow,false);
});
test('each stage can send and an unresolved or unknown outcome still stops the lane', () => {
  const guard = fixture();
  for (let n=1;n<=6;n++) { const {scope,wire}=teaching(guard,n); guard.armTeachingSend(scope); assert.equal(request(guard,'POST','/api/copilotkit/agent/default/run',wire).allow,true); }
  assert.equal(guard.summary().teachingRequests,6);
  const next=fixture(), first=teaching(next,1), second=teaching(next,2); next.armTeachingSend(first.scope); request(next,'POST','/api/copilotkit/agent/default/run',first.wire); next.stopTeaching();
  assert.throws(()=>next.armTeachingSend(second.scope),/TEACHING_SCOPE_NOT_VERIFIED/); assert.equal(next.summary().teachingRequests,1);
});
test('SDK optional suggestions are aborted without spending model budget or fabricating a successful response', () => {
  const guard=fixture();
  assert.equal(request(guard,'GET','/api/copilotkit/info').allow,true);
  assert.equal(request(guard,'POST','/api/copilotkit/agent/default/suggest',{}).kind,'optional-suggestion-blocked');
  assert.equal(request(guard,'POST','/api/copilotkit/agent/default/run',{forwardedProps:{toolChoice:{function:{name:'copilotkitSuggest'}}}}).allow,false);
  assert.equal(guard.fatal(),null); assert.equal(guard.summary().teachingRequests,0); assert.equal(guard.summary().suggestionsBlocked,2);
});

test('the interview lane permits ten independently bound interviews, denying repeated entities and an eleventh', () => {
  const guard = fixture();
  for (let index = 1; index <= 10; index++) {
    const { scope, wire } = teaching(guard, 2, `interview-${index}`);
    guard.armTeachingSend(scope);
    assert.equal(request(guard, 'POST', '/api/copilotkit/agent/default/run', wire).allow, true);
    assert.throws(() => guard.armTeachingSend(scope), /TEACHING_SCOPE_NOT_VERIFIED/);
  }
  assert.throws(() => guard.armTeachingSend(teaching(guard, 2, 'overflow').scope), /TEACHING_SCOPE_NOT_VERIFIED/);
  for (const stage of [1,3,4,5,6]) {
    const { scope, wire } = teaching(guard, stage);
    guard.armTeachingSend(scope);
    assert.equal(request(guard, 'POST', '/api/copilotkit/agent/default/run', wire).allow, true);
  }
  assert.equal(guard.summary().teachingRequests, 15);
  assert.equal(guard.summary().teachingRequestsAllowed, 37);
});

test('per-interview revision and finding each require the preceding bound turn and student confirmation', () => {
  const guard = fixture(), { scope, wire } = teaching(guard,2);
  assert.throws(() => guard.armTeachingSend({ ...scope, interviewFinding: true }), /TEACHING_FINDING_SCOPE_NOT_VERIFIED/);
  guard.armTeachingSend(scope);
  request(guard,'POST','/api/copilotkit/agent/default/run',wire);
  const row = { id:'owned-human', authorKind:'human', authorId:scope.actorId, text:scope.prompt, clientMessageId:'client-2', agentRunId:'actual-owned-run' };
  guard.observe(request(guard,'GET',`/api/chat/threads/${scope.threadId}/messages?limit=100`),200,{ messages:[row], nextCursor:null });
  const revision = { ...scope, prompt:'QA 合成学生修改问题，请针对上一次排队的经过继续追问。', interviewGuideRevision:true, knownMessages:[row] };
  assert.throws(() => guard.armTeachingSend(revision), /TEACHING_GUIDE_REVISION_NOT_VERIFIED/);
  guard.completeTeaching({ threadId:scope.threadId, inputMessageId:row.id, runId:row.agentRunId });
  guard.armTeachingSend(revision);
  const revisedWire = { ...wire, runId:'sdk-revision', messages:[{ id:'client-revision', role:'user',content:revision.prompt }], forwardedProps:{ ...wire.forwardedProps, clientMessageId:'client-revision' } };
  assert.equal(request(guard,'POST','/api/copilotkit/agent/default/run',revisedWire).allow,true);
  const revisionRow = {...row, id:'human-revision',text:revision.prompt, clientMessageId:'client-revision', agentRunId:'revision-run'};
  guard.observe(request(guard,'GET',`/api/chat/threads/${scope.threadId}/messages?limit=100`),200,{messages:[row,revisionRow],nextCursor:null});
  guard.completeTeaching({threadId:scope.threadId,inputMessageId:revisionRow.id,runId:revisionRow.agentRunId});
  const record = { id:scope.selector.entityId, code:'U01', guideConfirmed:true };
  const finding = { ...scope, interviewFinding:true, knownMessages:[row,revisionRow] };
  assert.throws(() => guard.armTeachingSend(finding), /TEACHING_FINDING_SCOPE_NOT_VERIFIED/);
  guard.observe(request(guard,'GET',`/api/projects/${project}/aidt/stages/2`),200,{ stage:{ projectId:project, stageId:2, revision:2, content:{ draft:{ fields:{ [`interviewRecord:${record.id}`]:JSON.stringify(record) } } } } });
  assert.doesNotThrow(() => guard.armTeachingSend(finding));
  assert.throws(() => guard.armTeachingSend(finding), /TEACHING_SCOPE_NOT_VERIFIED/);
});

test('automatic reconcile is limited to saved QA entities in stages one and two and takes no payload', () => {
  const entity = 'aaaa1111-1111-4111-8111-111111111111';
  for (const stageId of [1,2]) {
    const stagePath = `/api/projects/${project}/aidt/stages/${stageId}`, path = `${stagePath}/entities/${entity}/reconcile`;
    const fields = { [`${stageId === 1 ? 'problemEntity' : 'interviewRecord'}:${entity}`]: JSON.stringify({ id: entity }) };
    const ready = () => {
      const guard = fixture();
      guard.observe(request(guard, 'GET', stagePath), 200, { stage: { projectId:project, stageId, revision:2, content:{ draft:{ fields } } } });
      return guard;
    };
    assert.equal(request(ready(), 'POST', path).kind, 'reconcile-entity');
    assert.equal(request(fixture(), 'POST', path).allow, false);
    assert.equal(request(ready(), 'POST', path, { confirmed:true }).allow, false);
    assert.equal(request(ready(), 'POST', path + '?force=true').allow, false);
    assert.equal(request(ready(), 'POST', path.replace(entity, 'bbbb1111-1111-4111-8111-111111111111')).allow, false);
  }
});

test('a second S1 teaching request requires completed real feedback from the same problem and a substantive new input', () => {
  const guard = fixture(), { scope, wire } = teaching(guard,1);
  const revised = { ...scope, problemRevision:true, prompt:'QA合成，明确是午休时在窗口比较等待时间。' };
  assert.throws(() => guard.armTeachingSend(revised), /TEACHING_PROBLEM_REVISION_NOT_VERIFIED/);
  guard.armTeachingSend(scope); request(guard, 'POST','/api/copilotkit/agent/default/run',wire);
  const row = { id:'owned-human', authorKind:'human', authorId:scope.actorId, text:scope.prompt, clientMessageId:'client-1', agentRunId:'owned-run' };
  guard.observe(request(guard, 'GET',`/api/chat/threads/${scope.threadId}/messages?limit=100`),200,{ messages:[row], nextCursor:null });
  const proof = { threadId:scope.threadId, inputMessageId:row.id, runId:row.agentRunId };
  assert.throws(() => guard.completeTeaching({ ...proof, runId:'other' }), /TEACHING_COMPLETION_NOT_BOUND/);
  assert.throws(() => guard.armTeachingSend(revised), /TEACHING_PROBLEM_REVISION_NOT_VERIFIED/);
  guard.completeTeaching(proof);
  assert.throws(() => guard.armTeachingSend({ ...revised, prompt:scope.prompt, knownMessages:[row] }), /TEACHING_PROBLEM_REVISION_NOT_VERIFIED/);
  assert.throws(() => guard.armTeachingSend({ ...revised, threadId:'other', knownMessages:[row] }), /TEACHING_PROBLEM_REVISION_NOT_VERIFIED/);
  assert.doesNotThrow(() => guard.armTeachingSend({ ...revised, knownMessages:[row] }));
  assert.throws(() => guard.armTeachingSend({ ...revised, knownMessages:[row] }), /TEACHING_SCOPE_NOT_VERIFIED/);
});

test('a verified S1 pending receipt unlocks one separate QA problem only and never retries the unresolved thread', () => {
  const guard=fixture(), original=teaching(guard,1), other=teaching(guard,1,'separate');
  const synthetic={ ...other.scope, syntheticProblemFixture:true };
  assert.throws(() => guard.armTeachingSend(synthetic), /SYNTHETIC_PREREQUISITE_NOT_BOUND/);
  guard.armTeachingSend(original.scope);
  request(guard,'POST','/api/copilotkit/agent/default/run',original.wire);
  const input={ id:'initial', authorKind:'human', authorId:original.scope.actorId, text:original.scope.prompt, clientMessageId:'client-1', agentRunId:'owned-pending' };
  guard.observe(request(guard,'GET',`/api/chat/threads/${original.scope.threadId}/messages?limit=100`),200,{ messages:[input], nextCursor:null });
  const receipt={ stageId:1, projectId:project, threadId:original.scope.threadId, runId:input.agentRunId, inputMessageId:input.id, knownConfirmTaskIntent:true, toolName:'confirm_task_intent' };
  assert.throws(() => guard.recordPendingProblem({ ...receipt, threadId:'foreign' }), /SYNTHETIC_PREREQUISITE_NOT_BOUND/);
  guard.recordPendingProblem(receipt);
  assert.throws(() => guard.armTeachingSend({ ...original.scope, syntheticProblemFixture:true }), /SYNTHETIC_PREREQUISITE_NOT_BOUND/);
  assert.doesNotThrow(() => guard.armTeachingSend(synthetic));
  assert.throws(() => guard.armTeachingSend(synthetic), /TEACHING_SCOPE_NOT_VERIFIED/);
});
