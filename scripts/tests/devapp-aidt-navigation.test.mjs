import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedAidtProblemRoute, matchesAidtProblemRoute, openAidtProblemOutcome, assertSavedAidtProblemInput, requireAcceptedS1Feedback } from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';
import { ownedAidtEntityRoute, matchesAidtEntityRoute, openAidtEntityOutcome, assertSavedAidtHmwSource, verifyAidtFrozenBacklink } from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';
import { interviewCodePattern, savedAidtInterviewRoute, hasInterviewPrerequisite, hasPendingProblemReview } from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';

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

test('literal true native teaching acceptance permits S1 confirmation exactly once', async () => {
  const events = [];
  await requireAcceptedS1Feedback(async () => { events.push('native-feedback'); return true; });
  events.push('confirm-round', 'saved-handoff');
  assert.deepEqual(events, ['native-feedback', 'confirm-round', 'saved-handoff']);
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

test('only S1 acceptance or an explicitly confirmed synthetic prerequisite opens the ten chats', () => {
  for (const value of [undefined, false, 1, 'true']) {
    assert.equal(hasInterviewPrerequisite({ s1: value, syntheticHandoff: value }), false);
  }
  assert.equal(hasInterviewPrerequisite({ s1: true }), true);
  assert.equal(hasInterviewPrerequisite({ s1: false, syntheticHandoff: true }), true);
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

test('only the pending S1 intent receipt for this synthetic problem permits a manual prerequisite', () => {
  const href = 'https://devapp.boardx.us/aidt/prj-owned?step=1&entity=problem&thread=thr_current';
  const receipt = { stageId: 1, projectId: 'prj-owned', threadId: 'thr_current', knownConfirmTaskIntent: true, toolName: 'confirm_task_intent' };
  assert.equal(hasPendingProblemReview([{ receipt }], href, 'prj-owned'), true);
  for (const patch of [{ stageId: 2 }, { projectId: 'prj-other' }, { threadId: 'thr_other' }, { knownConfirmTaskIntent: false }, { toolName: 'other' }]) {
    assert.equal(hasPendingProblemReview([{ receipt: { ...receipt, ...patch } }], href, 'prj-owned'), false);
  }
  assert.equal(hasPendingProblemReview([], href, 'prj-owned'), false);
});
