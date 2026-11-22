import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAidtS2NativeChatEntry } from '../../apps/web/e2e/support/devapp-aidt-journey.mjs';

// Static adapter for diagnostic boundaries; a separate real Chromium fixture
// verifies the same helper's locator behavior. Neither is a Dev acceptance run.
function fixture(overrides = {}) {
  const threadId = 'thr_aidt_' + '3'.repeat(64);
  const entityId = '33333333-3333-4333-8333-333333333333';
  const href = `https://devapp.boardx.us/aidt/prj-synthetic?step=2&entity=${entityId}&tool=outcome&thread=${threadId}`;
  const state = { code: 'U03', welcome: '合成提纲初稿提示', editors: 0, ...overrides };
  const locators = {
    output: { visible: true, text: state.code, locator: () => ({ count: () => state.editors }) },
    welcome: { text: state.welcome }, input: { count: () => 1, editable: true }, heading: { count: () => 0 },
  };
  const expect = value => ({
    toBe: expected => assert.equal(value, expected),
    toMatch: pattern => assert.match(value, pattern),
    toBeVisible: () => assert.equal(value.visible, true),
    toContainText: text => assert.ok(value.text.includes(text)),
    toHaveText: text => assert.equal(value.text, text),
    toHaveCount: count => assert.equal(value.count(), count),
    toBeEditable: () => assert.equal(value.editable, true),
  });
  expect.poll = read => expect(read());
  const page = { url: () => href,
    getByTestId: id => ({ 'aidt-interview-output': locators.output, 'aidt-chat-welcome': locators.welcome, 'copilotkit-v2-input': locators.input })[id],
    getByRole: () => locators.heading };
  return { page, expect,
    target: { href, origin: 'https://devapp.boardx.us', projectId: 'prj-synthetic', stage: 2, entityId },
    createdThreadId: threadId, code: 'U03', interviewStarter: '合成提纲初稿提示',
    existingInterviews: [], diagnostics: { code: 'U03', phase: 'entry', checks: {} } };
}

test('successful entry records only scalar diagnostics and appends the bound interview', async () => {
  const f = fixture();
  assert.equal(await assertAidtS2NativeChatEntry(f), f.createdThreadId);
  assert.equal(f.diagnostics.phase, 'complete');
  assert.equal(f.diagnostics.checks.readonly, true);
  assert.equal(f.existingInterviews.length, 1);
  for (const value of Object.values(f.diagnostics.checks)) assert.ok(typeof value === 'boolean' || typeof value === 'number');
  for (const value of [f.target.href, f.createdThreadId, f.interviewStarter]) assert.ok(!JSON.stringify(f.diagnostics).includes(value));
});

test('another valid AIDT thread cannot satisfy the created-thread binding', async () => {
  const f = fixture(); f.createdThreadId = 'thr_aidt_' + '2'.repeat(64);
  await assert.rejects(assertAidtS2NativeChatEntry(f));
  assert.equal(f.diagnostics.phase, 'thread');
  assert.equal(f.diagnostics.checks.createdThreadMatches, false);
  assert.equal(f.existingInterviews.length, 0);
});

test('sibling identity is rejected before marking read-only success', async () => {
  const f = fixture(); f.existingInterviews.push({ threadId: f.createdThreadId, target: { entityId: 'other' } });
  await assert.rejects(assertAidtS2NativeChatEntry(f));
  assert.equal(f.diagnostics.phase, 'unique');
  assert.equal(f.diagnostics.checks.readonly, undefined);
  assert.equal(f.existingInterviews.length, 1);
});

test('read-only failure preserves the old internal append order without recording success', async () => {
  const f = fixture({ editors: 1 });
  await assert.rejects(assertAidtS2NativeChatEntry(f));
  assert.equal(f.diagnostics.phase, 'readonly');
  assert.equal(f.diagnostics.checks.readonlyEditableCount, 1);
  assert.equal(f.diagnostics.checks.readonly, undefined);
  assert.equal(f.existingInterviews.length, 1);
});

test('wrong private welcome text never enters diagnostics', async () => {
  const privateFixture = 'sensitive-source-fixture-should-not-export';
  const f = fixture({ welcome: privateFixture });
  await assert.rejects(assertAidtS2NativeChatEntry(f));
  assert.equal(f.diagnostics.phase, 'welcome');
  assert.equal(JSON.stringify(f.diagnostics).includes(privateFixture), false);
  assert.equal(f.existingInterviews.length, 0);
});

test('a known missing-starter failure retains its original code', async () => {
  const f = fixture(); f.interviewStarter = '';
  await assert.rejects(assertAidtS2NativeChatEntry(f), { code: 'INTERVIEW_SKILL_STARTER_MISSING' });
  assert.equal(f.diagnostics.phase, 'welcome');
});
