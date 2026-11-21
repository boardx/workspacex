import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedAidtProblemRoute, matchesAidtProblemRoute, openAidtProblemOutcome, assertSavedAidtProblemInput, requireAcceptedS1Feedback } from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';

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
