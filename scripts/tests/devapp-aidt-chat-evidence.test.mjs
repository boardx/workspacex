import { matchesInterviewProjection } from '../../apps/web/e2e/support/devapp-aidt-chat-evidence.mjs';
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

function pendingHarness({ mutate = () => {}, changeAcceptedRun = false, callback = () => {}, includeCallback = true, eventCallback = () => {}, approvalShown = false, dialogShown = false, visibilityThrows = false } = {}) {
  const s = scope(), e = evidence(s), r = request(s), events = [], reports = [];
  e.run.status = 'awaiting_tool_permission';
  e.run.pendingApproval = { permissionRequestId: 'permission-owned-1', toolName: 'confirm_task_intent', argsSummary: 'synthetic-private-summary', interrupt: { toolName: 'confirm_task_intent', args: { requestId: 'synthetic-private-arg-request', understanding: 'synthetic-private-understanding', assumptions: ['synthetic-private-assumption'] } } };
  mutate(e.run);
  let sent = false, resolveRequest, messagePoll = 0;
  const page = {
    url: () => `${s.origin}/aidt/${s.projectId}?step=1&thread=${s.threadId}&entity=${s.selector.entityId}`,
    getByTestId: name => name === 'copilotkit-v2-send' ? { click: async () => { sent = true; resolveRequest({ method: () => r.method, url: () => r.url, postDataJSON: () => r.body }); } }
      : ['restored-run-approval', 'chat-tool-permission-dialog'].includes(name) ? { isVisible: async () => { if (visibilityThrows) throw new Error('private visibility failure'); return name === 'restored-run-approval' ? approvalShown : dialogShown; }, getByRole: () => { assert.fail('passive helper must not open or approve any modal'); } }
      : { fill: async () => {}, count: async () => 0 },
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
  return { reports, events, result: () => sendTeachingFeedback({ page, expect, scope: s, read, armSend: () => {}, onEvent: async event => { events.push(event); return eventCallback(event); }, ...(includeCallback ? { onPendingReview: async receipt => { reports.push(receipt); return callback(receipt); } } : {}) }) };
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

test('upstream tool-review event preserves safe exact tool name and owned run coordinates after the passive callback', async () => {
  let callbackFinished = false;
  const h = pendingHarness({ mutate: run => { run.pendingApproval.toolName = 'write_todos'; }, callback: () => { callbackFinished = true; }, approvalShown: false, dialogShown: true, eventCallback: event => { if (event.event === 'teaching-tool-review-required') assert.equal(callbackFinished, true); } });
  await assert.rejects(h.result(), error => error.code === 'TEACHING_TOOL_REVIEW_REQUIRED');
  assert.equal(h.reports[0].toolName, 'other'); // The existing callback stays closed.
  const events = h.events.filter(event => event.event === 'teaching-tool-review-required');
  assert.deepEqual(events, [{ event: 'teaching-tool-review-required', stageId: 1, runId: 'backend-run-1', threadId: 'thr_aidt_owned', toolName: 'write_todos', approvalVisible: true, dialogOpened: true }]);
  assert.equal(JSON.stringify(events).includes('synthetic-private'), false);
});

test('without the scope-bound UI callback tool-review diagnostics only read visibility and never open a modal', async () => {
  const h = pendingHarness({ includeCallback: false, approvalShown: true, dialogShown: false });
  await assert.rejects(h.result(), error => error.code === 'TEACHING_TOOL_REVIEW_REQUIRED');
  assert.equal(h.reports.length, 0);
  const event = h.events.find(event => event.event === 'teaching-tool-review-required');
  assert.equal(event.approvalVisible, true); assert.equal(event.dialogOpened, false);
});

test('upstream exact tool-name diagnostic rejects unsafe or oversized strings and never exports args', async () => {
  for (const toolName of ['https://secret.invalid?token=private', '<script>private</script>', 'a'.repeat(129), null]) {
    const h = pendingHarness({ mutate: run => { run.pendingApproval.toolName = toolName; } });
    await assert.rejects(h.result(), error => error.code === 'TEACHING_TOOL_REVIEW_REQUIRED');
    const event = h.events.find(event => event.event === 'teaching-tool-review-required');
    assert.equal(event.toolName, null);
    assert.equal(JSON.stringify(event).includes('private'), false);
    assert.equal('argsSummary' in event || 'argumentFields' in event, false);
  }
});

test('foreign or changing run identity emits neither passive receipt nor upstream tool-review event', async () => {
  for (const options of [{ mutate: run => { run.threadId = 'foreign-thread'; } }, { changeAcceptedRun: true }]) {
    const h = pendingHarness(options);
    await assert.rejects(h.result(), error => error.code === 'TEACHING_ACCEPTANCE_MISMATCH');
    assert.equal(h.reports.length, 0); assert.equal(h.events.some(event => event.event === 'teaching-tool-review-required'), false);
  }
});

test('visibility or diagnostic-event failure does not mask the original tool-review stop', async () => {
  const unreadable = pendingHarness({ visibilityThrows: true });
  await assert.rejects(unreadable.result(), error => error.code === 'TEACHING_TOOL_REVIEW_REQUIRED');
  const event = unreadable.events.find(event => event.event === 'teaching-tool-review-required');
  assert.equal(event.approvalVisible, null); assert.equal(event.dialogOpened, null);
  for (const eventCallback of [event => { if (event.event === 'teaching-tool-review-required') throw new Error('private diagnostic error'); }, async event => { if (event.event === 'teaching-tool-review-required') throw new Error('private diagnostic error'); }]) {
    const h = pendingHarness({ eventCallback });
    await assert.rejects(h.result(), error => error.code === 'TEACHING_TOOL_REVIEW_REQUIRED');
    assert.equal(h.events.some(event => event.event === 'durable-run-succeeded'), false);
  }
});

test('only the current interview draft may advance alongside its bound native reply', () => {
  const scope = { stageId: 2, selector: { entityId: 'entity-a' }, prompt: 'QA synthetic student draft' };
  const key = 'interviewRecord:entity-a';
  const record = { id: 'entity-a', code: 'U01', original: '', goal: '', adopted: '', guideConfirmed: false, consent: null };
  const old = { schemaVersion: 1, draft: { fields: { [key]: JSON.stringify(record), sibling: 'unchanged' }, discoveryCards: [] } };
  const next = structuredClone(old);
  const revised = { ...record, original: scope.prompt, adopted: '请描述刚才的顺序？', draftTurnId: 'assistant-1' };
  next.draft.fields[key] = JSON.stringify(revised);
  next.draft.fields['interviewConfirmed:entity-a'] = '';
  assert.equal(matchesInterviewProjection(old, next, scope, 'assistant-1'), true);
  assert.equal(matchesInterviewProjection(old, next, scope, 'other-assistant'), false);
  for (const patch of [{ original: 'not the submitted draft' }, { guideConfirmed: true }, { consent: { notes: true } }, { id: 'sibling' }]) {
    const changed = structuredClone(next); changed.draft.fields[key] = JSON.stringify({ ...revised, ...patch });
    assert.equal(matchesInterviewProjection(old, changed, scope, 'assistant-1'), false);
  }
  const other = structuredClone(next); other.draft.fields.sibling = 'different';
  assert.equal(matchesInterviewProjection(old, other, scope), false);
  other.draft.fields.sibling = 'unchanged'; other.draft.discoveryCards.push({ id: 'another' });
  assert.equal(matchesInterviewProjection(old, other, scope), false);
});
test('finding projection preserves evidence references and rejects AI confirmation or another interview', () => {
  const scope = { stageId: 2, selector: { entityId: 'a' }, interviewFinding: true };
  const record = { id: 'a', code: 'U01', original: 'student', adopted:'question', guideConfirmed: true, draftTurnId:'guide-reply' };
  const old = { schemaVersion: 1, draft: { fields: { 'interviewRecord:a':JSON.stringify(record) }, discoveryCards:[] } };
  const next = structuredClone(old);
  next.draft.fields['interviewRecord:a'] = JSON.stringify({ ...record, draftTurnId:'finding-reply' });
  next.draft.fields['interviewInterpretation:a'] = 'tentative';
  next.draft.discoveryCards.push({ id:'a', participantCode:'U01', headlineKind:'student-summary', headline:'summary', context:'setting', quote:'excerpt', sourceRef:'', photoRef:'' });
  assert.equal(matchesInterviewProjection(old, next, scope, 'finding-reply'), true);
  for (const patch of [{sourceRef:'made-up'}, {photoRef:'private'}, {participantCode:'U02'}, {headlineKind:'unattributed'}]) {
    const changed=structuredClone(next); Object.assign(changed.draft.discoveryCards[0],patch);
    assert.equal(matchesInterviewProjection(old, changed, scope, 'finding-reply'), false);
  }
});

test('S1 draft projection is restricted to the exact successful turn and current unconfirmed problem', async () => {
  const { matchesProblemProjection } = await import('../../apps/web/e2e/support/devapp-aidt-chat-evidence.mjs');
  const entity = 'p-one', key = 'problemDraft:' + entity;
  const scope = { stageId: 1, selector: { entityId: entity } };
  const proof = { assistantMessageId: 'answer-2', inputMessageId: 'input-2' };
  const before = { schemaVersion: 1, draft: { fields: { ['problemEntity:' + entity]: JSON.stringify({ id: entity, archived: false }), other: 'untouched' } } };
  const after = structuredClone(before);
  const output = { initial: '校园午休', draftTurnId: 'answer-2', sourceDetails: '学生记录' };
  after.draft.fields[key] = JSON.stringify(output);
  assert.equal(matchesProblemProjection(before, after, scope, proof), true);
  for (const patch of [{ draftTurnId: 'foreign' }, { problemReflectionConfirmed: 'true' }, { roundCompletion: 'yes' }, { foreign: 'extra' }]) {
    after.draft.fields[key] = JSON.stringify({ ...output, ...patch });
    assert.equal(matchesProblemProjection(before, after, scope, proof), false);
  }
  after.draft.fields[key] = JSON.stringify(output);
  after.draft.fields.other = 'changed';
  assert.equal(matchesProblemProjection(before, after, scope, proof), false);
});

test('summary Skill proof requires the six current revisions and the exact history in its dispatch receipt', () => {
  const base = scope();
  const selected = { schemaVersion: 1, purpose: 'summary', projectId: base.projectId,
    stageRevisions: Array.from({ length: 6 }, (_, index) => ({ stageId: index + 1, revision: 3 })),
    historyRevisions: [{ stageId: 2, revision: 1 }, { stageId: 2, revision: 2 }] };
  const s = { ...base, stageId: 6, selector: selected };
  const e = evidence(s);
  delete e.receipt.stageId;
  Object.assign(e.receipt, { purpose: 'summary', stageRevisions: selected.stageRevisions, historyRevisions: selected.historyRevisions });
  const wire = validateTeachingWire(request(s), s);
  const accepted = identifyOwnedTeachingRun(e.messages, s, wire);
  assert.equal(validateTeachingEvidence(e, s, wire, accepted).sourceRevisions.length, 6);
  assert.throws(() => validateTeachingEvidence({ ...e, receipt: { ...e.receipt, historyRevisions: [] } }, s, wire, accepted));
  for (const selector of [{ ...selected, stageId: 6 }, { ...selected, stageRevisions: selected.stageRevisions.slice(0, 5) },
    { ...selected, historyRevisions: [selected.historyRevisions[0], selected.historyRevisions[0]] }]) {
    const wrong = { ...s, selector };
    assert.throws(() => validateTeachingWire(request(wrong), wrong));
  }
});
