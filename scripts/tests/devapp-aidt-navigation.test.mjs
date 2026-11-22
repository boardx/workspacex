import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ownedAidtProblemRoute, matchesAidtProblemRoute, openAidtProblemOutcome, assertAidtReadOnlyProblemOutput, assertSavedAidtProblemInput, requireAcceptedS1Feedback } from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';
import { ownedAidtEntityRoute, matchesAidtEntityRoute, openAidtEntityOutcome, assertSavedAidtHmwSource, verifyAidtFrozenBacklink } from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';
import { interviewCodePattern, savedAidtInterviewRoute, hasInterviewPrerequisite, hasPendingProblemReview } from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';

import { aidtS1Question, prepareAidtS1NativeResponse, runAidtS1NativeRevision, assertSavedAidtS1NativeDraft, assertSavedAidtS1Revision, assertAidtS1Handoff, assertAidtS2Topic } from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';

const origin = 'https://devapp.boardx.us';
const projectId = 'prj-navigation-fixture';
const entityId = '11111111-1111-4111-8111-111111111111';
const otherEntity = '22222222-2222-4222-8222-222222222222';
const scope = { origin, projectId };
const directory = `${origin}/aidt/${projectId}?step=1`;
const href = `${directory}&entity=${entityId}`;
const route = () => ownedAidtProblemRoute(href, scope);
const saved = initial => ({ revision: 3, content: { draft: { fields: {
  [`problemEntity:${entityId}`]: JSON.stringify({ id: entityId, title: '合成导航夹具', archived: false }),
  [`problemDraft:${entityId}`]: JSON.stringify({ initial }),
} } } });

function fakeNavigation({ destination = href, redirectOutcome, brokenReady = false } = {}) {
  let current = directory, clicked = false, polls = 0;
  const events = [];
  const page = {
    url: () => current,
    goto: async target => { events.push('goto-outcome'); assert.equal(clicked || polls === 0, true); current = redirectOutcome ?? target; },
  };
  const link = { getAttribute: async name => { assert.equal(name, 'href'); events.push('capture-href'); return href; }, click: async () => { events.push('click-link'); clicked = true; } };
  const waitForRoute = async predicate => {
    // Next Link has clicked, but pathname and old directory URL remain unchanged.
    for (let i = 0; i < 4; i++) {
      polls++;
      events.push(`poll-${predicate()}`);
      if (predicate()) return;
      if (clicked && i === 1) current = destination;
    }
    throw new Error('TEST_ROUTE_TIMEOUT');
  };
  const assertReady = async () => { events.push('actual-initial-input'); if (brokenReady) throw new Error('TEST_ENTITY_INPUT_MISSING'); };
  return { page, link, waitForRoute, assertReady, events, current: () => current };
}

test('delayed Next navigation waits for exact stage/entity before opening outcome', async () => {
  const f = fakeNavigation();
  const result = await openAidtProblemOutcome({ ...f, scope });
  assert.equal(result.entityId, entityId);
  assert.equal(matchesAidtProblemRoute(f.current(), result, true), true);
  assert.deepEqual(f.events, ['capture-href', 'click-link', 'poll-false', 'poll-false', 'poll-true', 'goto-outcome', 'poll-true', 'actual-initial-input']);
});

for (const [name, destination] of [
  ['directory sharing the same pathname', directory],
  ['wrong stage', href.replace('step=1', 'step=2')],
  ['wrong entity', href.replace(entityId, otherEntity)],
  ['foreign project', href.replace(projectId, 'prj-foreign')],
]) test(`never retargets outcome after delayed navigation reaches ${name}`, async () => {
  const f = fakeNavigation({ destination });
  await assert.rejects(openAidtProblemOutcome({ ...f, scope }), /TEST_ROUTE_TIMEOUT/);
  assert.equal(f.events.includes('goto-outcome'), false);
  assert.equal(f.events.includes('actual-initial-input'), false);
});

test('captured foreign project link is rejected before click or navigation', async () => {
  const f = fakeNavigation(); f.link.getAttribute = async () => href.replace(projectId, 'prj-foreign');
  await assert.rejects(openAidtProblemOutcome({ ...f, scope }), /S1_ENTITY_ROUTE_INVALID/);
  assert.deepEqual(f.events, []);
});

test('reentry opens the original entity outcome even when current page is directory or chat', async () => {
  for (const current of [directory, `${href}&tool=chat`]) {
    const events = []; let url = current;
    const page = { url: () => url, goto: async target => { events.push('goto'); url = target; } };
    await openAidtProblemOutcome({ page, route: route(), scope,
      waitForRoute: async predicate => { assert.equal(predicate(), true); },
      assertReady: async () => { events.push('actual-initial-input'); },
    });
    assert.equal(matchesAidtProblemRoute(url, route(), true), true);
    assert.deepEqual(events, ['goto', 'actual-initial-input']);
  }
});

test('outcome navigation cannot pass on a directory shared-save or wrong-entity redirect', async () => {
  for (const redirectOutcome of [directory, `${href.replace(entityId, otherEntity)}&tool=outcome`]) {
    let ready = false;
    const f = fakeNavigation({ redirectOutcome });
    await assert.rejects(openAidtProblemOutcome({ ...f, scope, assertReady: async () => { ready = true; } }), /TEST_ROUTE_TIMEOUT/);
    assert.equal(ready, false);
  }
});

test('correct outcome URL alone cannot stand in for the actual entity input', async () => {
  const f = fakeNavigation({ brokenReady: true });
  await assert.rejects(openAidtProblemOutcome({ ...f, scope }), /TEST_ENTITY_INPUT_MISSING/);
  assert.equal(matchesAidtProblemRoute(f.current(), route(), true), true);
});

test('navigation verifies the observed route even if a waiter returns without observing it', async () => {
  const f = fakeNavigation();
  await assert.rejects(openAidtProblemOutcome({ ...f, scope, waitForRoute: async () => {} }), /S1_ENTITY_NAVIGATION_UNVERIFIED/);
  assert.equal(f.events.includes('goto-outcome'), false);
  const reentry = fakeNavigation({ redirectOutcome: directory });
  await assert.rejects(openAidtProblemOutcome({ ...reentry, link: undefined, route: route(), scope, waitForRoute: async () => {} }), /S1_OUTCOME_NAVIGATION_UNVERIFIED/);
  assert.equal(reentry.events.includes('actual-initial-input'), false);
});

test('reentry verifies the saved original input in the exact problem record', () => {
  const expected = '合成原始命题的真实已存修订';
  assert.equal(assertSavedAidtProblemInput(saved(expected), entityId, expected), true);
  const foreign = saved('尚未保存的本地值'); foreign.content.draft.fields.initial = expected;
  foreign.content.draft.fields[`problemDraft:${otherEntity}`] = JSON.stringify({ initial: expected });
  assert.throws(() => assertSavedAidtProblemInput(foreign, entityId, expected), /S1_SAVED_INITIAL_UNVERIFIED/);
});

for (const [name, mutate] of [
  ['missing saved initial', s => { delete s.content.draft.fields[`problemDraft:${entityId}`]; }],
  ['directory save only', s => { s.content.draft.fields[`problemDraft:${entityId}`] = '{}'; }],
  ['unacknowledged revision', s => { s.revision = 0; }],
  ['archived problem', s => { s.content.draft.fields[`problemEntity:${entityId}`] = JSON.stringify({ id: entityId, archived: true }); }],
]) test(`reentry rejects ${name} without any repair write`, () => {
  const value = saved('合成已存命题'); mutate(value); const before = JSON.stringify(value);
  assert.throws(() => assertSavedAidtProblemInput(value, entityId, '合成已存命题'), /S1_SAVED_INITIAL_UNVERIFIED/);
  assert.equal(JSON.stringify(value), before);
});

test('ambiguous, legacy, credential-bearing and foreign-origin routes cannot target S1 input', () => {
  for (const value of [null, '', `${href}&step=2`, `${href}&entity=${otherEntity}`, `${href}&history=1`, `${href}&summary=1`, href.replace(origin, 'https://other.invalid'), href.replace('https://', 'https://fixture@'), `${href}#fragment`]) {
    assert.throws(() => ownedAidtProblemRoute(value, scope), /S1_ENTITY_ROUTE_INVALID/);
    assert.equal(matchesAidtProblemRoute(value, route()), false);
  }
});

test('a captured reentry target cannot silently change to a second problem', async () => {
  const f = fakeNavigation(); f.link.getAttribute = async () => href.replace(entityId, otherEntity);
  await assert.rejects(openAidtProblemOutcome({ ...f, route: route(), scope }), /S1_ENTITY_ROUTE_CHANGED/);
  assert.deepEqual(f.events, []);
});

for (const accepted of [false, undefined]) test(`S1 cannot confirm or hand off when native teaching checkpoint returns ${String(accepted)}`, async () => {
  const records = [], counters = { feedback: 0, confirmed: 0, nextStage: 0 };
  // Mirrors the production nesting: the inner checkpoint records its precise error
  // and returns a boolean instead of throwing into the outer stage checkpoint.
  const checkpoint = async (name, operation) => {
    try { await operation(); records.push({ name, status: 'passed' }); return true; }
    catch (error) { records.push({ name, status: 'failed', code: error.message }); return false; }
  };
  let handoff;
  const s1 = await checkpoint('s1-confirmed-reentry', async () => {
    await requireAcceptedS1Feedback(async () => {
      counters.feedback++;
      await checkpoint('teaching-chat-stage-1', async () => { throw new Error('ACTUAL_TEACHING_FAILURE'); });
      return accepted;
    });
    counters.confirmed++;
    handoff = 'saved-source-revision';
  });
  await checkpoint('s2-interview-handoff', async () => {
    if (!s1 || !handoff) throw new Error('S1_CONFIRMED_HANDOFF_REQUIRED');
    counters.nextStage++;
  });
  assert.deepEqual(counters, { feedback: 1, confirmed: 0, nextStage: 0 });
  assert.deepEqual(records, [
    { name: 'teaching-chat-stage-1', status: 'failed', code: 'ACTUAL_TEACHING_FAILURE' },
    { name: 's1-confirmed-reentry', status: 'failed', code: 'S1_TEACHING_FEEDBACK_REQUIRED' },
    { name: 's2-interview-handoff', status: 'failed', code: 'S1_CONFIRMED_HANDOFF_REQUIRED' },
  ]);
});

test('literal true passes only the feedback transport gate and does not itself confirm S1 I3', async () => {
  const events = [];
  await requireAcceptedS1Feedback(async () => { events.push('native-feedback'); return true; });
  events.push('feedback-gate-returned');
  assert.deepEqual(events, ['native-feedback', 'feedback-gate-returned']);
  for (const value of [1, 'true', {}, null]) await assert.rejects(requireAcceptedS1Feedback(async () => value), /S1_TEACHING_FEEDBACK_REQUIRED/);
});

test('an unexpected thrown teaching error is preserved without replacement or retry', async () => {
  const original = new Error('ORIGINAL_TEACHING_ERROR'); let calls = 0;
  await assert.rejects(requireAcceptedS1Feedback(async () => { calls++; throw original; }), error => error === original);
  assert.equal(calls, 1);
});

for (const stage of [2, 3, 6]) test(`stage ${stage} waits for exact entity and actual detail before outcome`, async () => {
  const target = ownedAidtEntityRoute(`${origin}/aidt/${projectId}?step=${stage}&entity=${entityId}`, scope, { stage });
  let current = `${origin}/aidt/${projectId}?step=${stage}`, activated = false;
  const events = [];
  await openAidtEntityOutcome({ target, page: { url: () => current, goto: async href => { events.push('outcome'); current = href; } },
    activate: async () => { activated = true; events.push('clicked-native'); },
    waitForRoute: async predicate => { if (!predicate() && activated) { events.push('wait-delayed-next'); current = target.href; } assert.equal(predicate(), true); },
    assertDetail: async () => { events.push('actual-entity-chat'); }, assertReady: async () => { events.push('actual-entity-form'); } });
  assert.deepEqual(events, ['clicked-native', 'wait-delayed-next', 'actual-entity-chat', 'outcome', 'actual-entity-form']);
  assert.equal(matchesAidtEntityRoute(current, target, 'outcome'), true);
});

test('same-path directory, wrong stage/entity and missing entity form cannot pass', async () => {
  const target = ownedAidtEntityRoute(href.replace('step=1', 'step=3'), scope, { stage: 3 });
  for (const bad of [directory.replace('step=1', 'step=3'), target.href.replace('step=3', 'step=2'), target.href.replace(entityId, otherEntity)]) {
    let opened = false;
    await assert.rejects(openAidtEntityOutcome({ target, page: { url: () => bad, goto: async () => { opened = true; } }, activate: async () => {}, waitForRoute: async () => {}, assertDetail: async () => {}, assertReady: async () => {} }), /ENTITY_NAVIGATION_UNVERIFIED/);
    assert.equal(opened, false);
  }
  let current = target.href;
  await assert.rejects(openAidtEntityOutcome({ target, page: { url: () => current, goto: async href => { current = href; } }, waitForRoute: async check => assert.equal(check(), true), assertReady: async () => { throw Error('ACTUAL_FORM_MISSING'); } }), /ACTUAL_FORM_MISSING/);
});

test('report requires exact same-project group-report and summary before opening preview', async () => {
  const url = `${origin}/aidt/${projectId}?step=6&summary=1&entity=group-report`;
  const target = ownedAidtEntityRoute(url, scope, { stage: 6, report: true, entityId: 'group-report' });
  for (const bad of [url.replace('&entity=group-report', ''), url.replace(projectId, 'prj-other'), url.replace('group-report', entityId), url.replace('summary=1', 'summary=0')]) {
    assert.throws(() => ownedAidtEntityRoute(bad, scope, { stage: 6, report: true, entityId: 'group-report' }), /ENTITY_ROUTE_INVALID/);
  }
  let current = url;
  await openAidtEntityOutcome({ target, tool: 'report', page: { url: () => current, goto: async href => { current = href; } }, waitForRoute: async check => assert.equal(check(), true), assertReady: async () => {} });
  assert.equal(matchesAidtEntityRoute(current, target, 'report'), true);
});

test('HMW prerequisite requires actual saved exact id/text/revision, not transient button visibility', () => {
  const expected = { id: 'hmw-fixture', text: '合成HMW', revision: 7 };
  const saved = source => ({ revision: 4, content: { draft: { fields: source === null ? {} : { ideaHmwSource: JSON.stringify(source) } } } });
  assert.equal(assertSavedAidtHmwSource(saved(expected), expected), true);
  for (const bad of [null, { ...expected, id: 'other' }, { ...expected, revision: 8 }, { ...expected, text: 'another' }]) assert.throws(() => assertSavedAidtHmwSource(saved(bad), expected), /HMW_SOURCE_NOT_SAVED/);
});

test('frozen source must be clicked and expose exact historical version and actual material', async () => {
  const href = `${origin}/aidt/${projectId}?step=2&entity=${entityId}&entityRevision=7&sourceId=original-fixture`;
  let current = directory; const events = [];
  const target = await verifyAidtFrozenBacklink({ scope, stage: 2, revision: 7, page: { url: () => current },
    link: { getAttribute: async () => href, click: async () => { events.push('actual-click'); current = href; } },
    waitForRoute: async check => assert.equal(check(), true), assertVersion: async () => { events.push('frozen-view'); }, assertMaterial: async () => { events.push('actual-original-preview'); } });
  assert.equal(target.revision, 7); assert.deepEqual(events, ['actual-click', 'frozen-view', 'actual-original-preview']);
  assert.equal(matchesAidtEntityRoute(href.replace('original-fixture', 'other-material'), target), false);
  assert.throws(() => ownedAidtEntityRoute(href + '&sourceId=other-material', scope, { stage: 2, revision: 7 }), /ENTITY_ROUTE_INVALID/);
  for (const url of [href.replace('entityRevision=7', 'entityRevision=8'), href.replace(projectId, 'prj-other')]) await assert.rejects(verifyAidtFrozenBacklink({ scope, stage: 2, revision: 7, page: {}, link: { getAttribute: async () => url } }), /ENTITY_ROUTE_INVALID/);
  await assert.rejects(verifyAidtFrozenBacklink({ scope, stage: 2, revision: 7, page: { url: () => current }, link: { getAttribute: async () => href, click: async () => {} }, waitForRoute: async check => assert.equal(check(), true), assertVersion: async () => {}, assertMaterial: async () => { throw Error('ORIGINAL_NOT_AVAILABLE'); } }), /ORIGINAL_NOT_AVAILABLE/);
  const noMaterial = href.replace('&sourceId=original-fixture', ''); current = noMaterial;
  await assert.rejects(verifyAidtFrozenBacklink({ scope, stage: 2, revision: 7, page: { url: () => current }, link: { getAttribute: async () => noMaterial, click: async () => {} }, waitForRoute: async check => assert.equal(check(), true), assertVersion: async () => {}, assertMaterial: async () => {} }), /FROZEN_MATERIAL_EXPECTATION_MISSING/);
});

test('all ten interview codes have exact suffix boundaries without admitting extra codes', () => {
  for (let n = 1; n <= 10; n++) {
    const code = `U${String(n).padStart(2, '0')}`, match = interviewCodePattern(code);
    for (const label of [code, `${code} 提纲草稿`, `${code}\n发现卡已核对`]) assert.equal(match.test(label), true);
    for (const label of [`${code}0`, `${code}x`, `X${code}`]) assert.equal(match.test(label), false);
  }
  for (const invalid of ['U00', 'U11', 'U010', 'U1', 'u01', ' U01', 'U01 ', null]) assert.throws(() => interviewCodePattern(invalid), /INTERVIEW_CODE_UNEXPECTED/);
});

test('only the original S1 acceptance opens formal interviews; diagnostic success never supplies its prerequisite', () => {
  for (const value of [undefined, false, 1, 'true']) {
    assert.equal(hasInterviewPrerequisite({ s1: value, syntheticHandoff: value }), false);
  }
  assert.equal(hasInterviewPrerequisite({ s1: true }), true);
  assert.equal(hasInterviewPrerequisite({ s1: false, syntheticHandoff: true }), false);
  const state = { s1: false, syntheticHandoff: true, s2: false, s3: false, s4: false, s5: false, s6: false };
  let formalWrites = 0;
  if (hasInterviewPrerequisite(state)) { formalWrites++; state.s2 = true; }
  assert.equal(formalWrites, 0); assert.equal(state.s1, false); assert.equal(state.s2, false);
  assert.equal([state.s1, state.s2, state.s3, state.s4, state.s5, state.s6].every(Boolean), false);
});

test('each interview target comes from its exact saved code and ID, never the current URL', () => {
  for (let n = 1; n <= 10; n++) {
    const code = `U${String(n).padStart(2, '0')}`, id = `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
    const record = { id, code }, stage = { revision: n, content: { draft: { fields: { [`interviewRecord:${id}`]: JSON.stringify(record) } } } };
    const target = savedAidtInterviewRoute(stage, code, directory.replace('step=1', 'step=2'), scope);
    assert.equal(target.entityId, id); assert.equal(target.stage, 2);
    assert.throws(() => savedAidtInterviewRoute(stage, code === 'U10' ? 'U01' : 'U10', directory.replace('step=1', 'step=2'), scope), /SAVED_INTERVIEW_ENTITY_UNVERIFIED/);
  }
  const fields = { [`interviewRecord:${entityId}`]: JSON.stringify({ id: entityId, code: 'U01' }), [`interviewRecord:${otherEntity}`]: JSON.stringify({ id: otherEntity, code: 'U01' }) };
  assert.throws(() => savedAidtInterviewRoute({ revision: 1, content: { draft: { fields } } }, 'U01', directory.replace('step=1', 'step=2'), scope), /SAVED_INTERVIEW_ENTITY_UNVERIFIED/);
});

test('storage-only frozen interviews still require actual historical navigation but never fabricate a material proof', async () => {
  const href = `${origin}/aidt/${projectId}?step=2&entity=${entityId}&entityRevision=7`;
  let current = directory, clicked = false, viewed = false, material = false;
  await verifyAidtFrozenBacklink({ scope, stage: 2, revision: 7, materialRequired: false, page: { url: () => current },
    link: { getAttribute: async () => href, click: async () => { clicked = true; current = href; } }, waitForRoute: async check => assert.equal(check(), true),
    assertVersion: async () => { viewed = true; }, assertMaterial: async () => { material = true; } });
  assert.equal(clicked && viewed, true); assert.equal(material, false);
});

test('a pending S1 receipt identifies the independent diagnostic only, without accepting the original S1', () => {
  const href = 'https://devapp.boardx.us/aidt/prj-owned?step=1&entity=problem&thread=thr_current';
  const receipt = { stageId: 1, projectId: 'prj-owned', threadId: 'thr_current', knownConfirmTaskIntent: true, toolName: 'confirm_task_intent' };
  assert.equal(hasPendingProblemReview([{ receipt }], href, 'prj-owned'), true);
  for (const patch of [{ stageId: 2 }, { projectId: 'prj-other' }, { threadId: 'thr_other' }, { knownConfirmTaskIntent: false }, { toolName: 'other' }]) {
    assert.equal(hasPendingProblemReview([{ receipt: { ...receipt, ...patch } }], href, 'prj-owned'), false);
  }
  assert.equal(hasPendingProblemReview([], href, 'prj-owned'), false);
});


const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const initial = '原生合成学生命题：了解午间饮品选择的犹豫。';
const firstPrompt = `合成软件验收。${initial} 尚无真实观察，问题来源是猜测。请先问一个开放问题。`;
const firstAssistant = '你们猜测的依据是什么，还需要了解哪一次具体经历？';
function proofFor({ checkpoint = 'teaching-chat-stage-1', prompt = firstPrompt, revision = 3, assistantText = firstAssistant, sequence = 1, ...patch } = {}) {
  return { stageId: 1, checkpoint, syntheticProblemFixture: false, status: 'passed', projectId, entityId,
    threadId: 'thr-native-s1', source: 'a'.repeat(40), tag: '12345678-1', prompt,
    runId: `run-${sequence}`, inputMessageId: `student-${sequence}`, assistantMessageId: `assistant-${sequence}`,
    sourceRevisions: [{ stageId: 1, revision }], studentTextSha256: sha(prompt), assistantTextSha256: sha(assistantText), assistantText, ...patch };
}
function questionFor(proof = proofFor(), proofs = [proof]) {
  return aidtS1Question(proofs, { projectId, entityId, threadId: proof.threadId, source: proof.source, tag: proof.tag,
    checkpoint: proof.checkpoint, prompt: proof.prompt, revision: proof.sourceRevisions[0].revision });
}
function nativeStage(revision, fields, { confirmed = false } = {}) {
  const draft = { ...fields };
  const aggregate = { [`problemEntity:${entityId}`]: JSON.stringify({ id: entityId, title: '原生合成问题', archived: false }) };
  if (confirmed) {
    draft.problemReflectionConfirmed = 'true';
    const digest = sha(canonical({ projectId, stageId: 1, draft: { fields: draft, ideas: [], selectedIdeaId: '' }, sources: [] }));
    draft.roundCompletion = JSON.stringify({ schemaVersion: 1, projectId, stageId: 1, digest });
    Object.assign(aggregate, draft, { problemHandoffEntity: entityId });
  }
  aggregate[`problemDraft:${entityId}`] = JSON.stringify(draft);
  return { projectId, stageId: 1, revision, sourceStageRevisions: [], content: { draft: { fields: aggregate } } };
}
function nativeFixture() {
  const question = questionFor();
  const firstFields = { initial, people: '合成学生', scene: '午间', activity: '选择饮品', whyWorth: '理解犹豫', problemSources: 'guess', draftTurnId: question.assistantMessageId };
  const original = assertSavedAidtS1NativeDraft(nativeStage(4, firstFields), question);
  const review = { ...question, approved: true, response: '目前只是本组猜测，还没有观察具体购买经过。', selectedDirection: '午休时间情境与选择',
    choiceReason: '先理解一次具体经过，暂不直接制作推荐App；需要真实研究。', rewrittenTheme: '我们想了解午休时间情境如何影响一次饮品选择。', h03ConversationSignoff: true, teachingQualityAccepted: true };
  const events = [];
  let stage = nativeStage(4, firstFields), reply;
  const args = { question, original,
    reviewStudentResponse: async q => { events.push('operator-review'); assert.equal(q, question); return review; },
    sendStudentResponse: async prompt => { events.push('send-one-native-response');
      const proof = proofFor({ checkpoint: 'teaching-chat-stage-1-revision', prompt, revision: original.revision, sequence: 2, assistantText: '依据学生回应整理了待确认的工作坊草稿，仍待真实研究。' });
      reply = questionFor(proof);
      stage = nativeStage(5, { ...firstFields, focus: review.selectedDirection, rewrittenTheme: review.rewrittenTheme, draftTurnId: reply.assistantMessageId }); return true; },
    readReply: async prompt => { events.push('read-precise-reply'); assert.equal(reply.studentPrompt, prompt); return reply; },
    readSaved: async () => { events.push('read-native-server-draft'); return structuredClone(stage); },
    reload: async () => { events.push('reload-exact-entity'); },
    assertUi: async snapshot => { events.push('assert-native-ui'); assert.deepEqual(snapshot.fields, JSON.parse(stage.content.draft.fields[`problemDraft:${entityId}`])); },
  };
  return { question, original, review, events, args, stage: () => stage, setStage: value => { stage = value; } };
}

test('S1 selects exactly the requested original checkpoint among fixture and revision proofs, never the first passed row', () => {
  const original = proofFor(), revision = proofFor({ checkpoint: 'teaching-chat-stage-1-revision', prompt: '另一个已验证的第二轮原生输入', revision: 4, sequence: 2 });
  const fixture = proofFor({ syntheticProblemFixture: true, checkpoint: 'teaching-chat-stage-1-fixture', entityId: otherEntity, threadId: 'thr-diagnostic', sequence: 3 });
  assert.equal(questionFor(original, [fixture, revision, original]).runId, original.runId);
  assert.equal(questionFor(revision, [fixture, original, revision]).runId, revision.runId);
  assert.equal(Object.isFrozen(questionFor()), true);
  for (const rows of [[], [fixture], [revision], [original, original], [{ ...original, status: 'failed' }], [{ ...original, syntheticProblemFixture: undefined }]]) assert.throws(() => questionFor(original, rows), /S1_ACTUAL_QUESTION_UNVERIFIED/);
  for (const key of ['projectId', 'entityId', 'threadId', 'source', 'tag', 'prompt', 'assistantTextSha256', 'studentTextSha256']) assert.throws(() => questionFor(original, [{ ...original, [key]: 'wrong' }]), /S1_ACTUAL_QUESTION_UNVERIFIED/);
  for (const key of ['runId', 'inputMessageId', 'assistantMessageId']) assert.throws(() => questionFor(original, [{ ...original, [key]: '' }]), /S1_ACTUAL_QUESTION_UNVERIFIED/);
  for (const refs of [[], [{ stageId: 1, revision: 2 }], [{ stageId: 2, revision: 3 }], [{ stageId: 1, revision: 3 }, { stageId: 2, revision: 1 }]]) assert.throws(() => questionFor(original, [{ ...original, sourceRevisions: refs }]), /S1_ACTUAL_QUESTION_UNVERIFIED/);
});

test('native revision uses one actual student response turn, exact persisted draftTurnId, reload and UI readback; never confirms', async () => {
  const fixture = nativeFixture(), result = await runAidtS1NativeRevision(fixture.args);
  assert.deepEqual(fixture.events, ['operator-review', 'send-one-native-response', 'read-precise-reply', 'read-native-server-draft', 'reload-exact-entity', 'read-native-server-draft', 'assert-native-ui']);
  assert.equal(result.draft.revision, 5); assert.equal(result.draft.fields.initial, initial);
  assert.equal(result.draft.fields.focus, fixture.review.selectedDirection); assert.equal(result.draft.fields.rewrittenTheme, fixture.review.rewrittenTheme);
  assert.equal(result.draft.fields.draftTurnId, result.reply.assistantMessageId);
  assert.equal(result.draft.fields.roundCompletion, undefined); assert.equal(result.draft.fields.problemReflectionConfirmed, undefined);
  assert.equal(result.h03ConversationSignoff, false); assert.equal(result.teachingQualityAccepted, false);
  assert.equal(result.review.h03ConversationSignoff, false); assert.equal(result.review.teachingQualityAccepted, false);
  for (const text of [fixture.question.assistantText, fixture.review.response, fixture.review.selectedDirection, fixture.review.choiceReason, fixture.review.rewrittenTheme]) assert.ok(result.review.prompt.includes(text));
});

test('missing/false/unknown/foreign reviews cannot send, save, rewrite, confirm or manufacture a generic answer', async () => {
  const missing = nativeFixture(); delete missing.args.reviewStudentResponse;
  await assert.rejects(runAidtS1NativeRevision(missing.args), /S1_I3_STUDENT_RESPONSE_REVIEW_REQUIRED/); assert.deepEqual(missing.events, []);
  for (const value of [false, null, undefined, {}, { approved: 'true' }]) {
    const fixture = nativeFixture(); fixture.args.reviewStudentResponse = async () => value;
    await assert.rejects(runAidtS1NativeRevision(fixture.args), /S1_I3_STUDENT_RESPONSE_REVIEW_REQUIRED/); assert.deepEqual(fixture.events, []);
    assert.equal(fixture.stage().revision, 4);
  }
  for (const key of ['projectId', 'entityId', 'threadId', 'runId', 'inputMessageId', 'assistantMessageId', 'assistantTextSha256']) {
    const fixture = nativeFixture(); fixture.review[key] = 'foreign';
    await assert.rejects(runAidtS1NativeRevision(fixture.args), /S1_I3_STUDENT_RESPONSE_REVIEW_REQUIRED/);
    assert.deepEqual(fixture.events, ['operator-review']); assert.equal(fixture.stage().revision, 4);
  }
});

test('copy-only or missing student work and out-of-bounds response/choice/theme stop before any native send', async () => {
  for (const patch of [{ response: '' }, { response: firstAssistant }, { selectedDirection: '' }, { choiceReason: '' }, { rewrittenTheme: '' }, { response: '答'.repeat(3001) }, { selectedDirection: '向'.repeat(121) }, { choiceReason: '由'.repeat(651) }, { rewrittenTheme: '题'.repeat(651) }]) {
    const fixture = nativeFixture(); Object.assign(fixture.review, patch);
    await assert.rejects(runAidtS1NativeRevision(fixture.args), /S1_I3_STUDENT_RESPONSE_REVIEW_REQUIRED/);
    assert.deepEqual(fixture.events, ['operator-review']); assert.equal(fixture.stage().revision, 4);
  }
});

test('650-character native rewrite is retained in full; composed second prompt accepts 5000 and rejects 5001 without truncation', async () => {
  const fixture = nativeFixture(); fixture.review.rewrittenTheme = '题'.repeat(650);
  const result = await runAidtS1NativeRevision(fixture.args); assert.equal(result.draft.fields.rewrittenTheme.length, 650);
  assert.doesNotThrow(() => assertAidtS2Topic({ problemEntityId: entityId, topicRevision: 6, topic: fixture.review.rewrittenTheme }, { entityId, revision: 6, rewrittenTheme: fixture.review.rewrittenTheme }));
  const base = nativeFixture(), short = await prepareAidtS1NativeResponse(base.question, async () => base.review);
  for (const length of [5000, 5001]) {
    const proof = proofFor({ assistantText: '问'.repeat(firstAssistant.length + length - short.prompt.length) }), question = questionFor(proof);
    const review = { ...base.review, ...question };
    if (length === 5000) { const prepared = await prepareAidtS1NativeResponse(question, async () => review); assert.equal(prepared.prompt.length, 5000); assert.equal(prepared.h03ConversationSignoff, false); }
    else await assert.rejects(prepareAidtS1NativeResponse(question, async () => review), /S1_I3_STUDENT_RESPONSE_REVIEW_REQUIRED/);
  }
});

test('native send false/unknown/error or reused reply scope/run/message IDs cannot reach reload or UI confirmation', async () => {
  for (const returned of [false, undefined, 1, 'true']) {
    const fixture = nativeFixture(); fixture.args.sendStudentResponse = async () => returned;
    await assert.rejects(runAidtS1NativeRevision(fixture.args), /S1_TEACHING_FEEDBACK_REQUIRED/); assert.deepEqual(fixture.events, ['operator-review']);
  }
  const failed = nativeFixture(); failed.args.sendStudentResponse = async () => { throw Error('NATIVE_SEND_FAILED'); };
  await assert.rejects(runAidtS1NativeRevision(failed.args), /NATIVE_SEND_FAILED/); assert.deepEqual(failed.events, ['operator-review']);
  for (const key of ['projectId', 'entityId', 'threadId', 'studentPrompt', 'revision', 'runId', 'inputMessageId', 'assistantMessageId']) {
    const fixture = nativeFixture(), originalRead = fixture.args.readReply;
    fixture.args.readReply = async prompt => ({ ...await originalRead(prompt), [key]: ['runId','inputMessageId','assistantMessageId'].includes(key) ? fixture.question[key] : key === 'revision' ? 3 : 'foreign' });
    await assert.rejects(runAidtS1NativeRevision(fixture.args), /S1_NATIVE_RESPONSE_UNVERIFIED/);
    assert.equal(fixture.events.includes('reload-exact-entity'), false); assert.equal(fixture.events.includes('assert-native-ui'), false);
  }
});

test('first native draft must preserve the original student input and a newly saved exact assistant projection', () => {
  const question = questionFor(), fields = { initial, draftTurnId: question.assistantMessageId };
  assert.equal(assertSavedAidtS1NativeDraft(nativeStage(4, fields), question).revision, 4);
  for (const patch of [{ initial: 'invented initial not in submitted prompt' }, { initial: '' }, { draftTurnId: 'other-assistant' }, { roundCompletion: 'true' }, { problemReflectionConfirmed: 'true' }, { nested: {} }]) assert.throws(() => assertSavedAidtS1NativeDraft(nativeStage(4, { ...fields, ...patch }), question), /S1_NATIVE_DRAFT_UNVERIFIED/);
  for (const broken of [{ ...nativeStage(4, fields), revision: 3 }, { ...nativeStage(4, fields), projectId: 'other' }, { ...nativeStage(4, fields), stageId: 2 }]) assert.throws(() => assertSavedAidtS1NativeDraft(broken, question), /S1_NATIVE_DRAFT_UNVERIFIED/);
  const archived = nativeStage(4, fields); archived.content.draft.fields[`problemEntity:${entityId}`] = JSON.stringify({ id: entityId, archived: true });
  assert.throws(() => assertSavedAidtS1NativeDraft(archived, question), /S1_NATIVE_DRAFT_UNVERIFIED/);
});

test('wrong or local-only native projection, edited student initial/theme/focus or changed reload cannot count as a saved response', async () => {
  for (const patch of [{ draftTurnId: 'unrelated' }, { initial: 'changed initial' }, { rewrittenTheme: 'model substituted theme' }, { focus: 'model substituted direction' }]) {
    const fixture = nativeFixture(), old = fixture.args.readSaved;
    fixture.args.readSaved = async () => { const stage = await old(); const fields = JSON.parse(stage.content.draft.fields[`problemDraft:${entityId}`]); Object.assign(fields, patch); stage.content.draft.fields[`problemDraft:${entityId}`] = JSON.stringify(fields); return stage; };
    await assert.rejects(runAidtS1NativeRevision(fixture.args), /S1_NATIVE_DRAFT_UNVERIFIED/); assert.equal(fixture.events.includes('reload-exact-entity'), false);
  }
  const localOnly = nativeFixture(); localOnly.args.readSaved = async () => nativeStage(4, localOnly.original.fields);
  await assert.rejects(runAidtS1NativeRevision(localOnly.args), /S1_NATIVE_DRAFT_UNVERIFIED/);
  const reentry = nativeFixture(), old = reentry.args.reload;
  reentry.args.reload = async () => { await old(); const stage = structuredClone(reentry.stage()), fields = JSON.parse(stage.content.draft.fields[`problemDraft:${entityId}`]); fields.scene = 'changed after reload'; stage.content.draft.fields[`problemDraft:${entityId}`] = JSON.stringify(fields); reentry.setStage(stage); };
  await assert.rejects(runAidtS1NativeRevision(reentry.args), /S1_REVIEWED_REVISION_UNVERIFIED/); assert.equal(reentry.events.includes('assert-native-ui'), false);
});

test('native confirmation permits only the new reflection flag and exact round digest on an incremented persisted revision', async () => {
  const fixture = nativeFixture(), { draft } = await runAidtS1NativeRevision(fixture.args), confirmed = nativeStage(6, draft.fields, { confirmed: true });
  assert.equal(assertSavedAidtS1Revision(confirmed, draft, { confirmed: true }), 6);
  assert.equal(assertSavedAidtS1Revision(confirmed, draft, { confirmed: true, revision: 6 }), 6);
  assert.throws(() => assertSavedAidtS1Revision(nativeStage(5, draft.fields), draft, { confirmed: true }), /S1_.*UNVERIFIED/);
  assert.throws(() => assertSavedAidtS1Revision({ ...confirmed, revision: 5 }, draft, { confirmed: true }), /S1_.*UNVERIFIED/);
  assert.throws(() => assertSavedAidtS1Revision({ ...confirmed, revision: 5 }, draft, { confirmed: true, revision: 5 }), /S1_.*UNVERIFIED/);
  for (const key of Object.keys(draft.fields)) {
    const mutated = structuredClone(confirmed), fields = JSON.parse(mutated.content.draft.fields[`problemDraft:${entityId}`]); fields[key] += ' changed'; mutated.content.draft.fields[`problemDraft:${entityId}`] = JSON.stringify(fields);
    assert.throws(() => assertSavedAidtS1Revision(mutated, draft, { confirmed: true }), /S1_REVIEWED_REVISION_UNVERIFIED/);
  }
  for (const patch of [{ problemHandoffEntity: otherEntity }, { roundCompletion: 'true' }]) {
    const mutated = structuredClone(confirmed); Object.assign(mutated.content.draft.fields, patch);
    assert.throws(() => assertSavedAidtS1Revision(mutated, draft, { confirmed: true }), /S1_CONFIRMED_REVISION_UNVERIFIED/);
  }
  const mirror = structuredClone(confirmed); mirror.content.draft.fields.focus = 'foreign mirror direction';
  assert.throws(() => assertSavedAidtS1Revision(mirror, draft, { confirmed: true }), /S1_.*UNVERIFIED/);
  const forged = nativeStage(6, { ...draft.fields, problemReflectionConfirmed: 'true', roundCompletion: 'true' });
  assert.throws(() => assertSavedAidtS1Revision(forged, draft, { confirmed: true }), /S1_.*UNVERIFIED/);
});

test('formal S2 href and interview topic must use the exact confirmed original entity/revision/full theme', () => {
  const confirmed = { entityId, revision: 6, rewrittenTheme: '学生确认的命题全文' }, href = `${origin}/aidt/${projectId}?step=2&problemEntity=${entityId}&problemRevision=6`;
  const record = { problemEntityId: entityId, topicRevision: 6, topic: confirmed.rewrittenTheme };
  assert.equal(assertAidtS1Handoff(href, scope, confirmed), href); assert.doesNotThrow(() => assertAidtS2Topic(record, confirmed));
  for (const bad of [href.replace(entityId, otherEntity), href.replace('problemRevision=6', 'problemRevision=5'), href.replace(projectId, 'other-project'), href + '&problemRevision=6', href + '&entity=' + entityId, href.replace('step=2', 'step=1'), href.replace(origin, 'https://foreign.example')]) assert.throws(() => assertAidtS1Handoff(bad, scope, confirmed), /S1_CONFIRMED_HANDOFF_UNVERIFIED/);
  for (const bad of [null, { ...record, problemEntityId: otherEntity }, { ...record, topicRevision: 5 }, { ...record, topic: '' }, { ...record, topic: 'different theme' }]) assert.throws(() => assertAidtS2Topic(bad, confirmed), /S2_CONFIRMED_TOPIC_UNVERIFIED/);
  for (const patch of [{ entityId: '' }, { revision: 0 }, { rewrittenTheme: '' }, { rewrittenTheme: '题'.repeat(651) }]) assert.throws(() => assertAidtS2Topic(record, { ...confirmed, ...patch }), /S2_CONFIRMED_TOPIC_UNVERIFIED/);
});


test('native selected direction must bind its exact ID and title to the student choice, including an explicitly adopted AI suggestion', () => {
  const proof = questionFor(proofFor({ checkpoint: 'teaching-chat-stage-1-revision', prompt: '合成学生回应与明确方向选择', revision: 4, sequence: 2 }));
  const focus = '学生选择的时间情境方向';
  const fields = { initial, focus, rewrittenTheme: '学生自己的重写命题', draftTurnId: proof.assistantMessageId, problemDirectionId: 'chosen' };
  for (const source of ['group', 'ai']) {
    const directions = [{ id: 'old', title: '第一轮的另一个方向', source: 'ai' }, { id: 'chosen', title: focus, source }];
    const saved = assertSavedAidtS1NativeDraft(nativeStage(5, { ...fields, problemDirections: JSON.stringify(directions) }), proof, { initial, focus, rewrittenTheme: fields.rewrittenTheme });
    assert.equal(saved.fields.problemDirectionId, 'chosen'); assert.equal(saved.fields.focus, focus);
  }
  const validDirections = [{ id: 'old', title: '第一轮的另一个方向', source: 'ai' }, { id: 'chosen', title: focus, source: 'group' }];
  for (const patch of [
    { problemDirectionId: 'old', problemDirections: JSON.stringify(validDirections) },
    { problemDirectionId: 'missing', problemDirections: JSON.stringify(validDirections) },
    { problemDirections: JSON.stringify([{ id: 'chosen', title: '不同的方向标题', source: 'group' }]) },
    { problemDirections: JSON.stringify([{ id: 'chosen', title: focus, source: 'unknown' }]) },
    { problemDirections: '{bad-json' },
    { problemDirections: JSON.stringify({ id: 'chosen', title: focus, source: 'group' }) },
  ]) assert.throws(() => assertSavedAidtS1NativeDraft(nativeStage(5, { ...fields, ...patch }), proof, { initial, focus, rewrittenTheme: fields.rewrittenTheme }), /S1_NATIVE_DRAFT_UNVERIFIED/);
});

import { assertSavedCardCreation } from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';

const creationProjectId = 'qa-project';
const creationFixtures = [
  [1, 'problem', 'problemEntity:'], [2, 'interview', 'interviewRecord:'],
  [3, 'surprise', 'definitionSurprise:'], [3, 'persona', 'definitionPersona:'],
  [3, 'hmw', 'definitionHmw:'], [4, 'idea'], [4, 'brainstorm', 'ideaBrainstorm:'], [5, 'prototype', 'prototypeEntity:'],
  [6, 'test', 'testGroup:'],
];
for (const [stage, kind, prefix] of creationFixtures) {
  test('only a single new persisted ' + kind + ' matches the opened entity', () => {
    const snap = (revision, ...ids) => ({ projectId: creationProjectId, stageId: stage, revision, content: { draft: {
      fields: prefix ? Object.fromEntries(ids.map(id => [prefix + id, '{}'])) : {},
      ideas: kind === 'idea' ? ids.map(id => ({ id })) : [],
    } } });
    const old = snap(3, 'older'), fresh = snap(4, 'older', 'new'), target = { projectId: creationProjectId, stage, entityId: 'new' };
    assert.doesNotThrow(() => assertSavedCardCreation(old, fresh, target, kind));
    assert.throws(() => assertSavedCardCreation(old, fresh, { ...target, entityId: 'older' }, kind));
    for (const invalid of [snap(4, 'new'), snap(3, 'older', 'new'), snap(4, 'older', 'third'), snap(4, 'older', 'new', 'extra'), { ...fresh, projectId: 'another' }, { ...fresh, stageId: stage + 1 }]) {
      assert.throws(() => assertSavedCardCreation(old, invalid, target, kind));
    }
  });
}
test('primary surprise uses its persistent identity flag', () => {
  const target = { projectId: creationProjectId, stage: 3, entityId: 'primary-surprise' };
  const before = { revision: 0, content: null };
  const after = { projectId: creationProjectId, stageId: 3, revision: 1, content: { draft: { fields: { definitionPrimaryEntity: 'true' } } } };
  assert.doesNotThrow(() => assertSavedCardCreation(before, after, target, 'surprise'));
  assert.throws(() => assertSavedCardCreation(before, after, { ...target, entityId: 'other' }, 'surprise'));
});

test('S1 outcome permits its native print action and still rejects editors and unknown actions', async () => {
  async function inspect({ editors = 0, buttons = 0, prints = 0 } = {}) {
    const locator = count => ({ count: async () => count });
    const panel = {
      locator(selector) {
        switch (selector) {
          case 'input,textarea,select,[contenteditable]:not([contenteditable="false"])': return locator(editors);
          case 'button,[role="button"]': return locator(buttons);
          case 'button[type="button"]': return 'native-action';
          default: assert.fail(selector);
        }
      },
      getByRole(role, options) {
        assert.equal(role, 'button');
        assert.deepEqual(options, { name: '打印', exact: true });
        return { and: other => { assert.equal(other, 'native-action'); return locator(prints); } };
      },
    };
    const expect = value => value === panel
      ? { toBeVisible: async () => {} }
      : { toHaveCount: async count => assert.equal(await value.count(), count) };
    expect.poll = read => ({ toBe: async expected => assert.equal(await read(), expected) });
    await assertAidtReadOnlyProblemOutput(panel, expect);
  }

  await inspect();
  await inspect({ buttons: 1, prints: 1 });
  await assert.rejects(inspect({ buttons: 1 }));
  await assert.rejects(inspect({ buttons: 2, prints: 1 }));
  await assert.rejects(inspect({ buttons: 2, prints: 2 }));
  await assert.rejects(inspect({ editors: 1, buttons: 1, prints: 1 }));
});
