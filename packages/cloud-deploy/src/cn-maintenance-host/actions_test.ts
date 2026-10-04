import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionDynamicActions } from './dynamic_gate';
import { offlinePreparedAction, exactMigrationAction } from './reused_actions';
const identity = { sourceRevision: 'a'.repeat(40), baselineRevision: 'b'.repeat(40), migrationPlanSha256: 'c'.repeat(64), attemptId: 'attempt-1' };
const collector = { path: '/usr/local/lib/workspacex-cn/collect-cn-release-preflight.sh', sha256: '1'.repeat(64) };
const verifier = { path: '/usr/local/lib/workspacex-cn/verify-cn-release-preflight.sh', sha256: '2'.repeat(64) };
test('held dynamic adapter rejects legacy bootstrap before any command or readback', async () => {
  const events: unknown[] = [];
  const adapter = productionDynamicActions(collector, verifier, '1.2.3', async (cmd, args) => { events.push([cmd.path, args]); return { stdout: 'ready=true' }; }, async () => { events.push('readback'); });
  await assert.rejects(adapter.verifyProductionDynamic(identity), { message: 'MAINTENANCE_HELD_PREFLIGHT_CONSUMER_NOT_IMPLEMENTED' });
  await assert.rejects(adapter.verifyPreactivate(identity), { message: 'DYNAMIC_GATE_NOT_COLLECTED' });
  assert.deepEqual(events, []);
});
test('preactivation cannot skip dynamic collection', async () => {
  let calls = 0;
  const adapter = productionDynamicActions(collector, verifier, '1.2.3', async () => { calls++; return { stdout: '' }; }, async () => { calls++; });
  await assert.rejects(adapter.verifyPreactivate(identity), { message: 'DYNAMIC_GATE_NOT_COLLECTED' }); assert.equal(calls, 0);
});
test('production commands cannot be redirected or release shell-injected', () => {
  const run = async () => ({ stdout: '' });
  assert.throws(() => productionDynamicActions({ ...collector, path: '/tmp/provision.sh' }, verifier, '1.2.3', run, async () => {}), { message: 'PREFLIGHT_COMMAND_AUTHORITY' });
  assert.throws(() => productionDynamicActions(collector, verifier, '1.2.3;evil', run, async () => {}), { message: 'RELEASE_INVALID' });
});
test('invalid preparation receipt rejected by real existing validator before artifact verification', async () => {
  let calls = 0;
  await assert.rejects(offlinePreparedAction({ ready: true }, Buffer.from('{}'), async () => { calls++; })(identity), { message: 'INVALID_PREPARED_CN_RELEASE' });
  assert.equal(calls, 0);
});
test('migration identity mismatch rejected before filesystem or database use', async () => {
  let calls = 0;
  const action = exactMigrationAction({ checkout: '/missing', plan: { targetSha: '0'.repeat(40), baselineSha: identity.baselineRevision, ledger: [] }, expectedCompletion: { originalPlanSha256: identity.migrationPlanSha256, attemptId: identity.attemptId } as any }, { migrate: async () => { calls++; return { applied: [], skipped: [] }; }, readFreshCompletion: async () => { calls++; return { snapshot: {}, binding: {} }; }, verifyLiveWriterBarrier: async () => { calls++; } });
  await assert.rejects(action(identity), { message: 'EXACT_MIGRATION_BINDING_MISMATCH' }); assert.equal(calls, 0);
});
