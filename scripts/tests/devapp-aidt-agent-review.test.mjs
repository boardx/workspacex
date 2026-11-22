import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, chmodSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentQaReviewRequested, createAgentQaReviewer, validateAgentQaReply, readAgentQaComments,
  AGENT_QA_CHANNEL, AGENT_QA_FILES } from '../../apps/web/e2e/support/devapp-aidt-agent-review.mjs';
import { AIDT_PDF_PLAN, assertAidtPrintRequest } from '../../apps/web/e2e/support/devapp-aidt-acceptance.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const origin = 'https://devapp.boardx.us';
const identity = { source: 'a'.repeat(40), tag: '44970170182-1', run: '44990000000', attempt: '1', entryDiagnosticOnly: false };
const controlSource = 'b'.repeat(40);
const initial = '合成验收数据，非真实访谈。想了解午间饮品选择的犹豫。';
const question = Object.freeze({ projectId: 'prj-agent-qa', entityId: '11111111-1111-4111-8111-111111111111',
  threadId: 'thr-agent-qa', runId: 'run-question', inputMessageId: 'student-question', assistantMessageId: 'assistant-question',
  assistantText: '你们的猜测来自哪一次经历，还有什么尚不清楚？',
  assistantTextSha256: hash('你们的猜测来自哪一次经历，还有什么尚不清楚？'), studentPrompt: initial, revision: 3 });
const work = { response: '目前只是本组猜测，尚未观察实际选择过程。', selectedDirection: '午间具体购买经过',
  choiceReason: '先理解经历和时间情境，暂不确定方案。', rewrittenTheme: '我们想了解午间情境如何影响饮品选择的犹豫。' };

function replyTo(request, bytes) {
  return { schemaVersion: 1, kind: 'aidt-agent-qa-response', reviewerKind: 'agent', repository: 'boardx/workspacex', issueNumber: 6944,
    phase: request.phase, nonce: request.nonce, sourceSha: request.sourceSha, controlSha: request.controlSha,
    workflowRunId: request.workflowRunId, workflowRunAttempt: request.workflowRunAttempt, releaseTag: request.releaseTag,
    requestSha256: hash(bytes), binding: request.binding, decision: request.phase === 'preflight' ? 'ready' : 'respond',
    work: request.phase === 'preflight' ? null : { ...work } };
}
function commentFor(request, bytes, id = 100) {
  return { id, user: { login: 'usamshen', id: 2325074, type: 'User' }, created_at: request.createdAt, updated_at: request.createdAt,
    body: JSON.stringify(replyTo(request, bytes)) };
}
function fixture(t, options = {}) {
  const out = mkdtempSync(join(tmpdir(), 'aidt-agent-review-')); chmodSync(out, 0o700); t.after(() => rmSync(out, { recursive: true, force: true }));
  let time = Date.parse('2026-11-22T03:00:00.000Z'), serial = 0, reads = 0;
  const exports = [];
  const transport = {
    async upload({ name, file, root }) {
      const bytes = readFileSync(file), request = JSON.parse(bytes.toString('utf8'));
      const entry = { name, file, root, bytes, request }; exports.push(entry);
      if (options.onUpload) return options.onUpload(entry);
      return { id: 1000 + exports.length };
    },
    async read() {
      reads++;
      const entry = exports.at(-1), rows = [commentFor(entry.request, entry.bytes, 100 + exports.length)];
      return options.onRead ? options.onRead(entry, reads, rows) : rows;
    },
    async wait(ms) { time += ms; },
  };
  const reviewer = createAgentQaReviewer({ identity, controlSource, out, transport,
    assertSafe: value => { if (value.includes('qa-private-sentinel')) throw Error('PRIVATE'); },
    now: () => time, nonce: () => (++serial).toString(16).padStart(64, '0'), ...options.factory });
  const page = new EventEmitter(), context = { pages: () => [page] }, frame = {};
  let url = `${origin}/aidt/${question.projectId}?step=1&entity=${question.entityId}&thread=${question.threadId}&tool=outcome`, closed = false;
  page.context = () => context; page.isClosed = () => closed; page.url = () => url; page.mainFrame = () => frame;
  let stage = { projectId: question.projectId, stageId: 1, revision: 4, sourceStageRevisions: [], content: { draft: { fields: {
    [`problemDraft:${question.entityId}`]: JSON.stringify({ initial, draftTurnId: question.assistantMessageId }),
  } } } };
  let messages = [ { id: question.inputMessageId, authorKind: 'human', agentRunId: question.runId, text: question.studentPrompt },
    { id: question.assistantMessageId, authorKind: 'agent', agentRunId: question.runId, text: question.assistantText } ];
  const binding = { page, context, readStage: async () => structuredClone(stage), readMessages: async () => structuredClone(messages) };
  return { reviewer, transport, exports, out, binding, page, context, frame,
    setUrl: value => { url = value; }, close: () => { closed = true; page.emit('close'); }, setStage: value => { stage = value; },
    stage: () => stage, setMessages: value => { messages = value; }, messages: () => messages, time: () => time,
    setTime: value => { time = value; }, reads: () => reads };
}

test('explicit agent opt-in never implies a human signoff or enables diagnostics', () => {
  assert.equal(agentQaReviewRequested({}), false); assert.equal(agentQaReviewRequested({ AIDT_AGENT_QA_REVIEW: 'false' }), false);
  assert.equal(agentQaReviewRequested({ AIDT_AGENT_QA_REVIEW: 'true', AIDT_LIVE_DEV: 'true' }), true);
  for (const value of ['', '1', 'TRUE', true]) assert.throws(() => agentQaReviewRequested({ AIDT_AGENT_QA_REVIEW: value }), /AGENT_QA_OPT_IN_INVALID/);
  assert.throws(() => agentQaReviewRequested({ AIDT_AGENT_QA_REVIEW: 'true' }), /AGENT_QA_OPT_IN_SCOPE_INVALID/);
  assert.throws(() => agentQaReviewRequested({ AIDT_AGENT_QA_REVIEW: 'true', AIDT_LIVE_DEV: 'true', AIDT_ENTRY_DIAGNOSTIC_ONLY: 'true' }), /AGENT_QA_OPT_IN_SCOPE_INVALID/);
});

test('preflight exports one fixed small request and verifies the root ACK before page binding', async t => {
  const f = fixture(t);
  assert.throws(() => f.reviewer.bindPage(f.binding), /AGENT_QA_PAGE_BINDING_REQUIRED/);
  const receipt = await f.reviewer.preflight();
  assert.equal(receipt.reviewerKind, 'agent'); assert.equal(receipt.h03ConversationSignoff, false);
  assert.equal(receipt.teachingQualityAccepted, false); assert.equal(f.reads(), 2);
  assert.equal(f.exports[0].name, `aidt-agent-qa-preflight-${identity.run}-1`);
  assert.equal(f.exports[0].request.question, null); assert.equal(f.exports[0].request.binding, null);
  assert.deepEqual(readdirSync(f.out), [AGENT_QA_FILES.preflight]);
  await assert.rejects(f.reviewer.preflight(), /AGENT_QA_PREFLIGHT_REPLAYED/);
});

test('actual question binds same page and saved version; callback returns student work but never sends or confirms', async t => {
  const f = fixture(t); await f.reviewer.preflight(); const callback = f.reviewer.bindPage(f.binding);
  const result = await callback(question);
  assert.equal(result.response, work.response); assert.equal(result.approved, true); assert.equal(result.savedRevision, 4);
  assert.equal(result.h03ConversationSignoff, false); assert.equal(result.teachingQualityAccepted, false);
  assert.equal(f.stage().revision, 4); assert.equal(f.messages().length, 2);
  assert.equal(f.exports.length, 2); assert.equal(f.exports[1].name, `aidt-agent-qa-student-${identity.run}-1`);
  assert.deepEqual(f.exports[1].request.question, { assistantText: question.assistantText, studentPrompt: question.studentPrompt });
  assert.equal(f.exports[1].request.binding.assistantMessageId, question.assistantMessageId);
  assert.equal(f.reviewer.summary().preflightPassed, true); assert.ok(f.reviewer.summary().bytesExported <= 32768);
  assert.equal(f.page.listenerCount('framenavigated'), 0); assert.equal(f.page.listenerCount('request'), 0);
  await assert.rejects(callback(question), /AGENT_QA_STUDENT_REVIEW_REPLAYED/);
  assert.throws(() => f.reviewer.bindPage(f.binding), /AGENT_QA_PAGE_BINDING_REQUIRED/);
});

for (const key of ['nonce','sourceSha','controlSha','workflowRunId','workflowRunAttempt','releaseTag','requestSha256','repository','issueNumber','phase']) {
  test(`reply rejects wrong ${key} without spending an application or model request`, async t => {
    const f = fixture(t, { onRead: (entry, _n, rows) => {
      const value = JSON.parse(rows[0].body); value[key] = key === 'issueNumber' ? 1 : 'wrong';
      const comment = { ...rows[0], body: JSON.stringify(value) };
      if (key === 'nonce') assert.throws(() => validateAgentQaReply(comment, entry.request, hash(entry.bytes), Date.parse(entry.request.createdAt), () => {}), /AGENT_QA_REPLY_BINDING_MISMATCH/);
      return [comment];
    } });
    await assert.rejects(f.reviewer.preflight(), key === 'nonce' ? /AGENT_QA_REVIEW_TIMEOUT/ : /AGENT_QA_REPLY_BINDING_MISMATCH/);
    assert.equal(f.reviewer.summary().preflightPassed, false); assert.equal(f.exports.length, 1);
  });
}

for (const variant of ['unknown-author','wrong-author-id','bot','edited','stale','future','duplicate','unknown-key','fenced-json']) {
  test(`refuses ${variant} root-channel material`, async t => {
    const f = fixture(t, { onRead: (_entry, _n, rows) => {
      const row = rows[0];
      if (variant === 'unknown-author') row.user.login = 'other';
      if (variant === 'wrong-author-id') row.user.id = 1;
      if (variant === 'bot') row.user.type = 'Bot';
      if (variant === 'edited') row.updated_at = '2026-11-22T03:00:01.000Z';
      if (variant === 'stale') row.created_at = row.updated_at = '2026-11-22T02:59:00.000Z';
      if (variant === 'future') row.created_at = row.updated_at = '2026-11-22T03:20:00.000Z';
      if (variant === 'duplicate') return [row, { ...row, id: row.id + 1 }];
      if (variant === 'unknown-key') { const body = JSON.parse(row.body); body.humanApproved = true; row.body = JSON.stringify(body); }
      if (variant === 'fenced-json') row.body = '```json\n' + row.body + '\n```';
      return rows;
    } });
    await assert.rejects(f.reviewer.preflight(), /AGENT_QA_(?:REPLY|REVIEW)/);
    assert.equal(f.reviewer.summary().preflightPassed, false);
  });
}

test('changed comment between first and confirmation GET is rejected', async t => {
  const f = fixture(t, { onRead: (_e, n, rows) => n === 2 ? [] : rows });
  await assert.rejects(f.reviewer.preflight(), /AGENT_QA_REPLY_CHANGED/);
});

test('duplicate JSON keys and escaped duplicate aliases are rejected rather than discarded', async t => {
  const f = fixture(t); await f.reviewer.preflight();
  const entry = f.exports[0], row = commentFor(entry.request, entry.bytes);
  for (const key of ['nonce', '\\u006eonce']) {
    const body = '{"' + key + '":"discarded",' + row.body.slice(1);
    assert.throws(() => validateAgentQaReply({ ...row, body }, entry.request, hash(entry.bytes), f.time(), () => {}), /AGENT_QA_REPLY_INVALID/);
  }
});

for (const changed of ['projectId','entityId','threadId','runId','inputMessageId','assistantMessageId','assistantTextSha256','revision','savedRevision']) {
  test(`student review refuses changed ${changed} binding`, async t => {
    const f = fixture(t, { onRead: (entry, _n, rows) => {
      if (entry.request.phase === 'student') { const body = JSON.parse(rows[0].body); body.binding[changed] = 'foreign'; rows[0].body = JSON.stringify(body); }
      return rows;
    } });
    await f.reviewer.preflight(); await assert.rejects(f.reviewer.bindPage(f.binding)(question), /AGENT_QA_REPLY_BINDING_MISMATCH/);
  });
}

for (const variant of ['navigation','away-back','reload','close','extra-send','stage-write','saved-version','extra-message']) {
  test(`pending review is invalidated by ${variant}`, async t => {
    let f;
    f = fixture(t, { onRead: (entry, _n, rows) => {
      if (entry.request.phase === 'student') {
        if (variant === 'navigation') f.setUrl(origin + '/home');
        if (variant === 'away-back' || variant === 'reload') f.page.emit('framenavigated', f.frame);
        if (variant === 'close') f.close();
        if (variant === 'extra-send') f.page.emit('request', { method: () => 'POST', url: () => origin + '/api/copilotkit/agent/default/run' });
        if (variant === 'stage-write') f.page.emit('request', { method: () => 'PUT', url: () => `${origin}/api/projects/${question.projectId}/aidt/stages/1` });
        if (variant === 'saved-version') f.setStage({ ...f.stage(), revision: 5 });
        if (variant === 'extra-message') f.setMessages([...f.messages(), { id: 'concurrent-student', text: '另一次发送', authorKind: 'human' }]);
      }
      return rows;
    } });
    await f.reviewer.preflight(); await assert.rejects(f.reviewer.bindPage(f.binding)(question), /AGENT_QA_(?:PAGE_CHANGED|SAVED_VERSION_CHANGED)/);
    assert.equal(f.page.listenerCount('framenavigated'), 0); assert.equal(f.page.listenerCount('request'), 0);
  });
}

test('ordinary iframe navigation does not impersonate a top-level navigation', async t => {
  let f; f = fixture(t, { onRead: (entry, _n, rows) => { if (entry.request.phase === 'student') f.page.emit('framenavigated', {}); return rows; } });
  await f.reviewer.preflight(); assert.equal((await f.reviewer.bindPage(f.binding)(question)).approved, true);
});

for (const value of ['Bearer abcdefghijklmnop', 'person@example.com', 'https://unknown.example/path', 'password=private', 'qa-private-sentinel']) {
  test('unsafe question never reaches the artifact producer', async t => {
    const f = fixture(t); await f.reviewer.preflight();
    await assert.rejects(f.reviewer.bindPage(f.binding)({ ...question, assistantText: value, assistantTextSha256: hash(value) }), /PRIVATE|SENSITIVE/);
    assert.equal(f.exports.length, 1);
  });
}

test('unsafe returned work is not accepted and no callback can issue the second native send', async t => {
  const f = fixture(t, { onRead: (entry, _n, rows) => {
    if (entry.request.phase === 'student') { const body = JSON.parse(rows[0].body); body.work.response = 'person@example.com'; rows[0].body = JSON.stringify(body); }
    return rows;
  } });
  await f.reviewer.preflight(); await assert.rejects(f.reviewer.bindPage(f.binding)(question), /AGENT_QA_PRIVATE_TEXT_REJECTED/);
  assert.equal(f.messages().length, 2);
});

test('missing secret guard and invalid output paths fail before any producer call', t => {
  const f = fixture(t);
  assert.throws(() => createAgentQaReviewer({ identity, controlSource, out: f.out }), /AGENT_QA_SECRET_GUARD_REQUIRED/);
  assert.throws(() => createAgentQaReviewer({ identity, controlSource, out: 'relative', assertSafe: () => {} }), /AGENT_QA_OUTPUT_INVALID/);
});

test('upload failure is terminal, no preflight acceptance or second upload', async t => {
  const f = fixture(t, { onUpload: () => { throw Error('offline'); } });
  await assert.rejects(f.reviewer.preflight(), /AGENT_QA_UPLOAD_FAILED/);
  assert.equal(f.reviewer.summary().preflightPassed, false); assert.equal(f.exports.length, 1);
});

for (const hung of ['upload','read','wait']) {
  test(`a never-settling ${hung} is bounded by the request deadline`, async t => {
    const deadline = Date.now() + 40;
    const f = fixture(t, { factory: { now: Date.now, deadlineAt: deadline } });
    if (hung === 'upload') f.transport.upload = () => new Promise(() => {});
    if (hung === 'read') f.transport.read = () => new Promise(() => {});
    if (hung === 'wait') { f.transport.read = async () => []; f.transport.wait = () => new Promise(() => {}); }
    // The factory captures transport functions on creation, so use a fresh factory with these exact functions.
    const reviewer = createAgentQaReviewer({ identity, controlSource, out: f.out, assertSafe: () => {}, transport: f.transport, deadlineAt: deadline });
    await assert.rejects(reviewer.preflight(), /AGENT_QA_REVIEW_TIMEOUT/);
    assert.equal(reviewer.summary().preflightPassed, false);
  });
}

test('student saved-state GETs share the same remaining deadline, including the post-review snapshot', async t => {
  for (const after of [false, true]) {
    const f = fixture(t, { factory: { now: Date.now, deadlineAt: Date.now() + 50 } });
    await f.reviewer.preflight(); let gets = 0;
    const callback = f.reviewer.bindPage({ ...f.binding, readStage: async () => {
      gets++; if (gets === (after ? 2 : 1)) return new Promise(() => {}); return structuredClone(f.stage());
    } });
    await assert.rejects(callback(question), /AGENT_QA_REVIEW_TIMEOUT/);
    assert.equal(f.page.listenerCount('request'), 0);
  }
});

test('public issue transport has one fixed host/path, no auth, no redirects and a bounded body', async () => {
  const created = '2026-11-22T03:00:00.000Z'; let seen;
  const rows = await readAgentQaComments(created, async (url, options) => {
    seen = { url, options }; return { status: 200, url, body: [Buffer.from('[]')] };
  });
  assert.deepEqual(rows, []); assert.equal(seen.url, 'https://api.github.com/repos/boardx/workspacex/issues/6944/comments?per_page=100&since=' + encodeURIComponent(created));
  assert.equal(seen.options.redirect, 'error'); assert.equal(Object.keys(seen.options.headers).some(key => /authorization/i.test(key)), false);
  await assert.rejects(readAgentQaComments(created, async url => ({ status: 200, url: url + '&elsewhere=1', body: [] })), /AGENT_QA_GITHUB_READ_FAILED/);
  await assert.rejects(readAgentQaComments(created, async url => ({ status: 403, url, body: [] })), /AGENT_QA_GITHUB_READ_FAILED/);
  await assert.rejects(readAgentQaComments(created, async url => ({ status: 200, url, body: [Buffer.alloc(1048577)] })), /AGENT_QA_REPLY_PAGE_BOUND/);
  assert.equal(AGENT_QA_CHANNEL.maxArtifacts, 2); assert.equal(AGENT_QA_CHANNEL.maxRequestBytes, 32768);
});

test('main preflights before QA credentials/bootstrap, rechecks runtime, keeps the original evidence verdicts', () => {
  const source = readFileSync(new URL('../../apps/web/e2e/support/devapp-aidt-acceptance.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('await agentReviewer.preflight()') < source.indexOf('readQaCredentials()'));
  assert.ok(source.indexOf('const afterReviewPreflight = runtimeProof(identity)') < source.indexOf('readQaCredentials()'));
  assert.ok(source.indexOf('await agentReviewer.preflight()') < source.indexOf('await bootstrapOrdinaryQaIdentity('));
  assert.ok(source.includes('createAnonymousPage, createSurveyParticipant, reviewS1StudentResponse, report'));
  assert.ok(source.includes('agent-operated-software-qa')); assert.ok(source.includes('不是人类课堂或教师教学签核'));
  assert.ok(source.includes('report.fullAcceptancePassed = false')); assert.ok(source.includes('report.realModelVerified = false'));
});

test('only the exact sixteen approved PDF outputs are admitted; duplicate, unknown, wrong stage and seventeenth are refused', () => {
  assert.equal(AIDT_PDF_PLAN.length, 16); assert.equal(new Set(AIDT_PDF_PLAN.map(item => item.name)).size, 16);
  const artifacts = [];
  for (const item of AIDT_PDF_PLAN) {
    const printName = assertAidtPrintRequest(item.stage, item.name.toUpperCase(), artifacts);
    artifacts.push({ format: 'pdf', printName });
    assert.throws(() => assertAidtPrintRequest(item.stage, item.name, artifacts), /PRINT_ARTIFACT_BOUND/);
  }
  assert.throws(() => assertAidtPrintRequest(2, 'interview-guide-u01', artifacts), /PRINT_ARTIFACT_BOUND/);
  assert.throws(() => assertAidtPrintRequest(2, 'seventeenth-output', artifacts), /PRINT_ARTIFACT_BOUND/);
  assert.throws(() => assertAidtPrintRequest(3, 'idea-description-1', []), /PRINT_ARTIFACT_BOUND/);
  assert.throws(() => assertAidtPrintRequest(2, 'interview-guide-u11', []), /PRINT_ARTIFACT_BOUND/);
  assert.throws(() => assertAidtPrintRequest(4, 'idea-description-4', []), /PRINT_ARTIFACT_BOUND/);
});
