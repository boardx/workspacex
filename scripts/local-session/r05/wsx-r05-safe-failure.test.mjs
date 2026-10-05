import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFailureState, recordFailure, reportFailure } from './wsx-r05-safe-failure.mjs';

test('falsy primary failures remain failures and survive cleanup aggregation', () => {
  for (const primary of [null, 0, undefined, false, '']) {
    const state = createFailureState();
    recordFailure(state, primary);
    assert.equal(state.hasPrimaryFailure, true);
    assert.equal(state.primaryFailure, primary);
    const cleanup = new Error('private cleanup cause');
    recordFailure(state, cleanup);
    assert.deepEqual(state.primaryFailure.errors, [primary, cleanup]);
    const lines = [], terminal = {};
    reportFailure(state, { error: (...args) => lines.push(args) }, terminal);
    assert.deepEqual(lines, [['R05_SETUP_OR_ACCEPTANCE_FAILED']]);
    assert.equal(terminal.exitCode, 1);
  }
});

test('public terminal output never includes raw error secrets or stack', () => {
  const state = createFailureState(), raw = new Error('TOKEN=private-secret https://private.invalid');
  raw.stack = 'private raw stack';
  recordFailure(state, raw);
  assert.equal(state.primaryFailure, raw);
  const lines = [], terminal = {};
  reportFailure(state, { error: (...args) => lines.push(args) }, terminal);
  assert.deepEqual(lines, [['R05_SETUP_OR_ACCEPTANCE_FAILED']]);
  assert.equal(terminal.exitCode, 1);
  const success = createFailureState(), untouched = {};
  reportFailure(success, { error: () => assert.fail('unexpected output') }, untouched);
  assert.deepEqual(untouched, {});
});
