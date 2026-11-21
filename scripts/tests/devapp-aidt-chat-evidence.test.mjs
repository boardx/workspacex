import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTeachingWire, identifyOwnedTeachingRun, validateTeachingEvidence, sendTeachingFeedback } from '../../apps/web/e2e/support/devapp-aidt-chat-evidence.mjs';
const scope = () => ({ origin: 'https://devapp.boardx.us', projectId: 'prj-owned', stageId: 1, threadId: 'thr_aidt_owned', actorId: 'qa-actor', prompt: 'QA合成材料：只给一个追问，不保存、生成文件或替学生确认。', skillId: 'skill-teaching', skillVersionId: 'skv-stage1', selector: { schemaVersion: 1, projectId: 'prj-owned', purpose: 'stage', stageId: 1, entityId: 'entity-1', stageRevisions: [{ stageId: 1, revision: 2 }] }, knownMessages: [] });
function request(s = scope()) { return { method: 'POST', url: 'https://devapp.boardx.us/api/copilotkit/agent/default/run', body: { threadId: 'copilotkit-v2-transport', runId: 'sdk-correlation', messages: [{ id: 'client-1', role: 'user', content: s.prompt }], tools: [], state: {}, context: [], forwardedProps: { clientMessageId: 'client-1', chatThreadId: s.threadId, aidtContext: s.selector } } }; }
function evidence(s = scope()) {
  const human = { id: 'msg-human', authorKind: 'human', authorId: s.actorId, clientMessageId: 'client-1', text: s.prompt, agentRunId: 'backend-run-1' };
  const reply = { id: 'msg-agent', authorKind: 'agent', authorId: 'agent', agentRunId: 'backend-run-1', text: '你们的选题来源是观察还是猜测？' };
  const messages = { messages: [human, reply], nextCursor: null };
  const run = { runId: 'backend-run-1', threadId: s.threadId, inputMessageId: human.id, resultMessageId: reply.id, status: 'succeeded', skillVersionIds: [s.skillVersionId], agentVersionId: 'av-one', modelProvider: 'provider-reported', modelId: 'model-reported' };
  const receipt = { runId: run.runId, projectId: s.projectId, purpose: 'stage', stageId: s.stageId, skillVersionId: s.skillVersionId, snapshotHash: 'a'.repeat(64), stageRevisions: s.selector.stageRevisions, historyRevisions: [], application: { state: 'message-dispatch-observed', attemptId: 'backend-run-1:0', assembledContextHash: 'b'.repeat(64), assembledAt: '2026-11-21T08:00:00Z', messageDispatchedAt: '2026-11-21T08:00:01Z' } };
  return { messages, run, receipt };
}
const rejects = (fn, code) => assert.throws(fn, error => error.code === code);
test('validates normal coordinates-only UI send and keeps SDK IDs distinct from durable ID', () => {
  const s = scope(), wire = validateTeachingWire(request(s), s), e = evidence(s);
  assert.equal(wire.sdkRunId, 'sdk-correlation');
  const accepted = identifyOwnedTeachingRun(e.messages, s, wire);
  assert.deepEqual(accepted, { runId: 'backend-run-1', inputMessageId: 'msg-human' });
  const proof = validateTeachingEvidence(e, s, wire, accepted);
  assert.equal(proof.runId, 'backend-run-1'); assert.equal(proof.providerIndependentlyVerified, false); assert.equal(proof.teachingQualityAccepted, false);
  assert.equal(proof.assistantText, e.messages.messages[1].text);
  assert.equal('stageSavedByAgent' in proof, false); // Only the UI helper actually checks saved stages.
});
test('uses real receipt fields without pretending entityId is returned', () => {
  const s = scope(), e = evidence(s), wire = validateTeachingWire(request(s), s);
  assert.equal('entityId' in e.receipt, false);
  assert.equal(validateTeachingEvidence(e, s, wire, identifyOwnedTeachingRun(e.messages, s, wire)).sourceRevisions[0].revision, 2);
});
for (const [name, mutate] of [
  ['foreign origin', r => { r.url = 'https://other.invalid/api/copilotkit/agent/default/run'; }],
  ['direct legacy send', r => { r.url = 'https://devapp.boardx.us/api/chat/threads/x/messages'; }],
  ['resume', r => { r.body.resume = {}; }],
  ['parent run', r => { r.body.parentRunId = 'existing-run'; }],
]) test(`rejects ${name}`, () => { const r = request(); mutate(r); rejects(() => validateTeachingWire(r, scope()), 'TEACHING_WIRE_TARGET_INVALID'); });
for (const [name, mutate] of [
  ['foreign thread', r => { r.body.forwardedProps.chatThreadId = 'another-thread'; }],
  ['foreign project', r => { r.body.forwardedProps.aidtContext = { ...r.body.forwardedProps.aidtContext, projectId: 'another-project' }; }],
  ['different entity', r => { r.body.forwardedProps.aidtContext = { ...r.body.forwardedProps.aidtContext, entityId: 'another-entity' }; }],
  ['different saved version', r => { r.body.forwardedProps.aidtContext = { ...r.body.forwardedProps.aidtContext, stageRevisions: [{ stageId: 1, revision: 1 }] }; }],
  ['permission passthrough', r => { r.body.forwardedProps.permissionRequestId = 'permission'; }],
]) test(`rejects ${name}`, () => { const r = request(); mutate(r); rejects(() => validateTeachingWire(r, scope()), 'TEACHING_WIRE_SCOPE_MISMATCH'); });
test('rejects edited student text, attachment messages and unverified history', () => {
  const s = scope(), r = request(s); r.body.messages[0].content += 'changed'; rejects(() => validateTeachingWire(r, s), 'TEACHING_STUDENT_TEXT_MISMATCH');
  r.body.messages[0].content = [{ type: 'image', url: 'https://outside.invalid/image' }]; rejects(() => validateTeachingWire(r, s), 'TEACHING_NON_TEXT_MESSAGE');
  const added = request(s); added.body.messages.unshift({ id: 'not-durable', role: 'assistant', content: 'fabricated previous reply' }); rejects(() => validateTeachingWire(added, s), 'TEACHING_HISTORY_NOT_CANONICAL');
});
test('recognizes existing history only from independently read durable rows', () => {
  const s = scope(); s.knownMessages = [{ id: 'previous', authorKind: 'agent', text: 'previous durable reply' }];
  const r = request(s); r.body.messages.unshift({ id: 'previous', role: 'assistant', content: 'previous durable reply' });
  assert.equal(validateTeachingWire(r, s).clientMessageId, 'client-1');
});
test('acceptance waits for real backend ID and rejects another author/text/duplicate match', () => {
  const s = scope(), wire = validateTeachingWire(request(s), s), e = evidence(s);
  const human = e.messages.messages[0]; human.agentRunId = null; assert.equal(identifyOwnedTeachingRun(e.messages, s, wire), null);
  human.agentRunId = 'backend-run-1'; human.authorId = 'someone-else'; rejects(() => identifyOwnedTeachingRun(e.messages, s, wire), 'TEACHING_ACCEPTANCE_MISMATCH');
  human.authorId = s.actorId; human.text += 'changed'; rejects(() => identifyOwnedTeachingRun(e.messages, s, wire), 'TEACHING_ACCEPTANCE_MISMATCH');
  human.text = s.prompt; e.messages.messages.push({ ...human }); rejects(() => identifyOwnedTeachingRun(e.messages, s, wire), 'TEACHING_ACCEPTANCE_MISMATCH');
});
for (const status of ['running', 'awaiting_tool_permission', 'paused', 'cancelled', 'failed']) test(`RUN_FINISHED-equivalent state ${status} is not success`, () => {
  const s = scope(), wire = validateTeachingWire(request(s), s), e = evidence(s); e.run.status = status;
  rejects(() => validateTeachingEvidence(e, s, wire, identifyOwnedTeachingRun(e.messages, s, wire)), 'TEACHING_DURABLE_RUN_NOT_SUCCEEDED');
});
test('requires exact durable result/thread/input/pin rather than any new assistant text', () => {
  const s = scope(), wire = validateTeachingWire(request(s), s);
  for (const key of ['threadId', 'inputMessageId', 'resultMessageId', 'skillVersionIds']) {
    const e = evidence(s); e.run[key] = key === 'skillVersionIds' ? ['another-pin'] : 'other';
    const code = key === 'resultMessageId' ? 'TEACHING_DURABLE_REPLY_MISSING' : 'TEACHING_DURABLE_RUN_NOT_SUCCEEDED';
    rejects(() => validateTeachingEvidence(e, s, wire, identifyOwnedTeachingRun(e.messages, s, wire)), code);
  }
});
test('requires correct receipt project/stage/pin/revisions and non-SDK backend run ID', () => {
  const s = scope(), wire = validateTeachingWire(request(s), s);
  for (const [key, value] of [['projectId', 'other'], ['runId', wire.sdkRunId], ['stageId', 2], ['skillVersionId', 'other-pin'], ['stageRevisions', [{ stageId: 1, revision: 99 }]]]) {
    const e = evidence(s); e.receipt[key] = value;
    rejects(() => validateTeachingEvidence(e, s, wire, identifyOwnedTeachingRun(e.messages, s, wire)), 'TEACHING_CONTEXT_RECEIPT_MISMATCH');
  }
});
test('prepared/assembled receipt or forged dispatch facts never prove applied material', () => {
  const s = scope(), wire = validateTeachingWire(request(s), s);
  for (const change of [{ state: 'prepared' }, { state: 'assembled' }, { attemptId: 'another-run:0' }, { messageDispatchedAt: null }, { assembledContextHash: null }]) {
    const e = evidence(s); Object.assign(e.receipt.application, change);
    rejects(() => validateTeachingEvidence(e, s, wire, identifyOwnedTeachingRun(e.messages, s, wire)), 'TEACHING_CONTEXT_DISPATCH_UNPROVEN');
  }
});

test('a frozen first receipt cannot be silently replaced by another snapshot', () => {
  const s = scope(), wire = validateTeachingWire(request(s), s), e = evidence(s), accepted = identifyOwnedTeachingRun(e.messages, s, wire);
  assert.equal(validateTeachingEvidence(e, s, wire, accepted, e.receipt.snapshotHash).snapshotHash, e.receipt.snapshotHash);
  rejects(() => validateTeachingEvidence(e, s, wire, accepted, 'c'.repeat(64)), 'TEACHING_CONTEXT_SNAPSHOT_CHANGED');
});

test('normal UI helper fills an initially disabled composer before checking send readiness', async () => {
  const s = scope(), e = evidence(s), r = request(s), events = [];
  let text = '', sent = false, armed = false, resolveRequest;
  const input = { kind: 'input', fill: async value => { text = value; events.push('fill'); } };
  const send = { kind: 'send', click: async () => {
    assert.ok(armed, 'guard must arm before the one real UI click');
    assert.equal(text, s.prompt, 'empty composer is not sendable');
    sent = true; events.push('click');
    resolveRequest({ method: () => r.method, url: () => r.url, postDataJSON: () => r.body });
  } };
  const page = {
    url: () => `${s.origin}/aidt/${s.projectId}?step=1&thread=${s.threadId}&entity=${s.selector.entityId}`,
    getByTestId: name => name === 'copilotkit-v2-input' ? input : name === 'copilotkit-v2-send' ? send : { count: async () => 0 },
    waitForRequest: () => new Promise(resolve => { resolveRequest = resolve; }),
  };
  const expect = locator => ({
    toBeVisible: async () => assert.equal(locator, input),
    toHaveCount: async count => assert.equal(await locator.count(), count),
    toBeEnabled: async () => {
      assert.equal(locator, send);
      events.push('check-send-enabled');
      assert.ok(text.trim().length > 0, 'native send stays disabled until input.fill');
    },
  });
  expect.poll = callback => ({ toBe: async expected => assert.equal(await callback(), expected) });
  const read = async path => ({ status: 200, data: path.includes('/messages?') ? (sent ? e.messages : { messages: [], nextCursor: null }) : path.endsWith('/aidt-context') ? e.receipt : path.includes('/agent-runs/') ? e.run : { stage: path, revision: 2 } });
  assert.equal(text, '', 'composer starts empty and disabled');
  const proof = await sendTeachingFeedback({ page, expect, scope: s, read, armSend: () => { armed = true; events.push('arm'); } });
  assert.deepEqual(events, ['fill', 'check-send-enabled', 'arm', 'click']);
  assert.equal(proof.runId, e.run.runId);
  assert.equal(proof.stageVersionsUnchanged, true);
});

test('synchronous guard arm failure creates no request waiter and never clicks send', async () => {
  const s = scope(), armError = new Error('GUARD_ARM_REFUSED');
  let waiterCount = 0, clickCount = 0, armCount = 0;
  const page = {
    url: () => `${s.origin}/aidt/${s.projectId}?step=1&thread=${s.threadId}&entity=${s.selector.entityId}`,
    getByTestId: () => ({ fill: async () => {}, click: async () => { clickCount++; } }),
    waitForRequest: () => { waiterCount++; return new Promise(() => {}); },
  };
  const expect = () => ({ toBeVisible: async () => {}, toHaveCount: async () => {}, toBeEnabled: async () => {} });
  const read = async path => ({ status: 200, data: path.includes('/messages?') ? { messages: [], nextCursor: null } : { revision: 1 } });
  await assert.rejects(sendTeachingFeedback({ page, expect, scope: s, read, armSend: () => { armCount++; throw armError; } }), error => error === armError);
  assert.equal(armCount, 1);
  assert.equal(waiterCount, 0, 'failed guard must not leave a future rejecting request waiter');
  assert.equal(clickCount, 0);
});

function pendingHarness({ mutate = () => {}, changeAcceptedRun = false, callback = () => {} } = {}) {
  const s = scope(), e = evidence(s), r = request(s), events = [], reports = [];
  e.run.status = 'awaiting_tool_permission';
  e.run.pendingApproval = { permissionRequestId: 'permission-owned-1', toolName: 'confirm_task_intent', argsSummary: 'synthetic-private-summary', interrupt: { toolName: 'confirm_task_intent', args: { requestId: 'synthetic-private-arg-request', understanding: 'synthetic-private-understanding', assumptions: ['synthetic-private-assumption'] } } };
  mutate(e.run);
  let sent = false, resolveRequest, messagePoll = 0;
  const page = {
    url: () => `${s.origin}/aidt/${s.projectId}?step=1&thread=${s.threadId}&entity=${s.selector.entityId}`,
    getByTestId: name => name === 'copilotkit-v2-send' ? { click: async () => { sent = true; resolveRequest({ method: () => r.method, url: () => r.url, postDataJSON: () => r.body }); } } : { fill: async () => {}, count: async () => 0 },
    waitForRequest: () => new Promise(resolve => { resolveRequest = resolve; }),
  };
  const expect = () => ({ toBeVisible: async () => {}, toHaveCount: async () => {}, toBeEnabled: async () => {} });
  expect.poll = fn => ({ toBe: async expected => { for (let attempt = 0; attempt < 3; attempt++) if (await fn() === expected) return; assert.fail('bounded fixture poll did not terminate'); } });
  const read = async path => {
    if (path.includes('/messages?')) {
      if (!sent) return { status: 200, data: { messages: [], nextCursor: null } };
      messagePoll++;
      if (changeAcceptedRun && messagePoll > 1) e.messages.messages[0].agentRunId = 'changed-backend-run';
      return { status: 200, data: e.messages };
    }
    if (path.endsWith('/aidt-context')) return { status: 200, data: e.receipt };
    if (path.includes('/agent-runs/')) return { status: 200, data: changeAcceptedRun && messagePoll === 1 ? { ...e.run, status: 'running' } : e.run };
    return { status: 200, data: { revision: 2 } };
  };
  return { reports, events, result: () => sendTeachingFeedback({ page, expect, scope: s, read, armSend: () => {}, onEvent: event => events.push(event), onPendingReview: async receipt => { reports.push(receipt); return callback(receipt); } }) };
}

test('pending review exports only owned coordinates and closed argument types once, and stays blocked', async () => {
  const h = pendingHarness({ callback: () => false });
  await assert.rejects(h.result(), error => error.code === 'TEACHING_TOOL_REVIEW_REQUIRED');
  assert.equal(h.reports.length, 1);
  assert.deepEqual(h.reports[0], { projectId: 'prj-owned', stageId: 1, threadId: 'thr_aidt_owned', runId: 'backend-run-1', inputMessageId: 'msg-human', permissionRequestId: 'permission-owned-1', toolName: 'confirm_task_intent', knownConfirmTaskIntent: true, argumentFields: [{ name: 'requestId', type: 'string' }, { name: 'understanding', type: 'string' }, { name: 'assumptions', type: 'array-of-strings' }], argumentShapeKnown: true });
  assert.equal(JSON.stringify(h.reports).includes('synthetic-private'), false);
  assert.equal(h.events.some(event => event.event === 'durable-run-succeeded'), false);
});

test('foreign run, thread, input or skill identity cannot emit pending review metadata', async () => {
  for (const [key, value] of [['runId', 'foreign-run'], ['threadId', 'foreign-thread'], ['inputMessageId', 'foreign-input'], ['skillVersionIds', ['foreign-skill']]]) {
    const h = pendingHarness({ mutate: run => { run[key] = value; } });
    await assert.rejects(h.result(), error => error.code === 'TEACHING_ACCEPTANCE_MISMATCH');
    assert.equal(h.reports.length, 0);
  }
  const changed = pendingHarness({ changeAcceptedRun: true });
  await assert.rejects(changed.result(), error => error.code === 'TEACHING_ACCEPTANCE_MISMATCH');
  assert.equal(changed.reports.length, 0);
});

test('unknown or malicious tool names and arbitrary args do not leak into passive review', async () => {
  for (const toolName of ['write_todos', 'unknown-secret-tool', 'https://private.invalid/secret?token=secret', '<script>secret</script>']) {
    const h = pendingHarness({ mutate: run => { run.pendingApproval.toolName = toolName; run.pendingApproval.permissionRequestId = 'bad/token?secret'; run.pendingApproval.interrupt = { toolName, args: { 'secret-field': 'secret-value' } }; } });
    await assert.rejects(h.result(), error => error.code === 'TEACHING_TOOL_REVIEW_REQUIRED');
    assert.equal(h.reports.length, 1);
    assert.equal(h.reports[0].toolName, 'other'); assert.equal(h.reports[0].knownConfirmTaskIntent, false);
    assert.deepEqual(h.reports[0].argumentFields, []); assert.equal(h.reports[0].argumentShapeKnown, false); assert.equal(h.reports[0].permissionRequestId, null);
    assert.equal(JSON.stringify(h.reports).includes('secret'), false);
  }
});

test('extra argument keys and malformed or unbounded known values cannot claim a known argument shape', async () => {
  for (const change of [args => { args['private-extra-key'] = 'private-extra-value'; }, args => { args.assumptions = ['ok', { token: 'private-extra-value' }]; }, args => { args.assumptions = Array(65).fill('ok'); }, args => { args.assumptions = ['x'.repeat(10001)]; }, args => { args.assumptions = ['']; }, args => { args.understanding = 'x'.repeat(10001); }, args => { delete args.requestId; }]) {
    const h = pendingHarness({ mutate: run => change(run.pendingApproval.interrupt.args) });
    await assert.rejects(h.result(), error => error.code === 'TEACHING_TOOL_REVIEW_REQUIRED');
    assert.equal(h.reports[0].argumentShapeKnown, false);
    assert.equal(JSON.stringify(h.reports).includes('private-extra'), false);
    assert.equal(h.reports[0].argumentFields.every(field => ['requestId', 'understanding', 'assumptions'].includes(field.name) && ['string', 'array-of-strings', 'other'].includes(field.type)), true);
  }
});

test('throwing or rejecting passive review callback preserves the original tool-review failure', async () => {
  for (const callback of [() => { throw new Error('private callback details'); }, async () => { throw new Error('private callback details'); }]) {
    const h = pendingHarness({ callback });
    await assert.rejects(h.result(), error => error.code === 'TEACHING_TOOL_REVIEW_REQUIRED' && !String(error).includes('private'));
    assert.equal(h.reports.length, 1); assert.equal(h.events.some(event => event.event === 'durable-run-succeeded'), false);
  }
});
