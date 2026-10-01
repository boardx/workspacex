import assert from 'node:assert/strict';
import test from 'node:test';
import { createAcceptanceRequestScheduler } from './board-navigation-acceptance-scheduler.mjs';

test('concurrent requests dispatch serially with a full test-policy interval', async () => {
  let clock = 0, active = 0; const dispatches = [];
  const scheduler = createAcceptanceRequestScheduler({ now: () => clock, wait: async ms => { clock += ms; } });
  await Promise.all([0, 1, 2].map(id => scheduler.run(async () => {
    assert.equal(active++, 0, 'tasks may not overlap'); dispatches.push({ id, time: clock });
    await Promise.resolve(); active--; return id;
  })));
  assert.deepEqual(dispatches, [{ id: 0, time: 0 }, { id: 1, time: 1000 }, { id: 2, time: 2000 }]);
  assert.deepEqual(scheduler.statistics, { intervalMs: 1000, requestCount: 3, throttleWaitMs: 2000, actualMinDispatchSpacingMs: 1000 });
});

test('an early timer cannot dispatch early or inflate actual wait evidence', async () => {
  let clock = 0, waits = 0;
  const scheduler = createAcceptanceRequestScheduler({ now: () => clock, wait: async ms => { clock += ++waits === 1 ? ms / 2 : ms; } });
  await scheduler.run(() => clock);
  assert.equal(await scheduler.run(() => clock), 1000);
  assert.equal(waits, 2, 'early wake must wait the remaining deadline');
  assert.equal(scheduler.statistics.throttleWaitMs, 1000);
  assert.equal(scheduler.statistics.actualMinDispatchSpacingMs, 1000);
});

test('a failed request remains rejected and does not bypass pacing for the next request', async () => {
  let clock = 0;
  const scheduler = createAcceptanceRequestScheduler({ now: () => clock, wait: async ms => { clock += ms; } });
  await assert.rejects(scheduler.run(() => { throw new Error('HTTP 429'); }), /HTTP 429/);
  assert.equal(await scheduler.run(() => clock), 1000);
  assert.equal(scheduler.statistics.requestCount, 2, 'failure must not be retried');
});
