import test from 'node:test';
import assert from 'node:assert/strict';
import { bindARouteHostOperations, type ARouteHostActions } from './a_route_adapter';
import { runARouteMaintenanceRelease } from './a_route';
import type { HostBinding } from './controller';
import type { CommandRunner } from './fixed_transport';
const identity = { sourceRevision: '9'.repeat(40), baselineRevision: 'b'.repeat(40), migrationPlanSha256: 'a'.repeat(64), attemptId: 'local-fixture' };
const names = ['prepareOffline','verifyPreholdRecoveryCapability','verifyIsolatedCandidateAcceptance','blockAllWrites','verifyWritesBlocked','captureAndVerifyCurrentEpochRecovery','verifyCurrentEpochIsolatedCandidateAcceptance','migrateExactPlan','verifyHeldCandidateReadback','stageCandidateRuntime','verifyCandidateRuntimeIdentity','persistCandidateResumeIntent','resumeExactCandidateWriters','verifyCandidateWritersResumed','verifyPublicAcceptance','observeOpenedCandidate','blockCandidateWriters','verifyNoMigrationCommitted','resumeUnchangedBaselineCancellation','verifyBaselineCancellation','recordRecoveryRequired','recordReconciliationRequired'] as const;
function fixture(fail?: string) {
  const calls: string[] = [];
  const actions: any = { acquireReleaseLock: async () => { calls.push('lock'); return async () => { calls.push('unlock'); }; } };
  for (const name of names) actions[name] = async () => { calls.push(name); if (name === fail) throw Error('injected failure'); };
  let current: any;
  let readMutator = (value: any) => value;
  const run: CommandRunner = async (_command, args, input) => {
    calls.push('hold:' + args[0]);
    if (args[0] === 'create') current = { schemaVersion: 1, state: 'held', identity, generation: '1'.repeat(32), sha256: '2'.repeat(64), device: 1, inode: 2 };
    if (args[0] === 'clear') { assert.deepEqual(input, current); current = { ...current, state: 'cleared', sha256: '3'.repeat(64) }; }
    return { stdout: JSON.stringify(args[0] === 'read' ? readMutator(current) : current), stderr: '' };
  };
  const command = { path: '/usr/local/lib/workspacex-cn/hold.py', sha256: '4'.repeat(64) };
  const binding: HostBinding = { identity, writerPlanPath: '/etc/workspacex-cn/plan.json', writerPlanSha256: '5'.repeat(64), writerPlanCanonicalSha256: '6'.repeat(64), hold: command, writerFence: command };
  return { calls, actions: actions as ARouteHostActions, run, binding, assertProtectedInputs: async () => { calls.push('admission'); }, mutateRead: (fn: typeof readMutator) => { readMutator = fn; } };
}
const request = { ...identity, maintenanceOptIn: 'stop-all-writes-and-require-database-recovery' as const };
test('concrete hold adapter uses CAS and independent clear readback after candidate public acceptance', async () => {
  const f = fixture(); const ops = await bindARouteHostOperations(f); await runARouteMaintenanceRelease(request, ops);
  assert.equal(f.calls[0], 'admission');
  assert.ok(f.calls.indexOf('verifyCandidateRuntimeIdentity') < f.calls.indexOf('persistCandidateResumeIntent'));
  assert.ok(f.calls.indexOf('verifyCandidateWritersResumed') < f.calls.indexOf('verifyPublicAcceptance'));
  assert.deepEqual(f.calls.slice(-5), ['verifyPublicAcceptance', 'hold:clear', 'hold:read', 'observeOpenedCandidate', 'unlock']);
});
test('missing candidate transport accumulates blockers before admission or lock', async () => {
  const f = fixture(); delete (f.actions as any).resumeExactCandidateWriters; delete (f.actions as any).verifyCandidateWritersResumed;
  await assert.rejects(bindARouteHostOperations(f), /A_ROUTE_HOST_CAPABILITY_MISSING:resumeExactCandidateWriters,verifyCandidateWritersResumed/);
  assert.deepEqual(f.calls, []);
});
test('identity mismatch blocks every adapter operation including lock and hold', async () => {
  const f = fixture(); const ops = await bindARouteHostOperations(f);
  for (const name of Object.keys(ops) as (keyof typeof ops)[]) await assert.rejects(ops[name]({ ...identity, attemptId: 'foreign' }), /IDENTITY_CHANGED/);
  assert.deepEqual(f.calls, ['admission']);
});
test('held generation drift causes reconciliation and lock retention before migration', async () => {
  const f = fixture(); const ops = await bindARouteHostOperations(f);
  f.mutateRead(value => ({ ...value, generation: 'f'.repeat(32) }));
  await assert.rejects(runARouteMaintenanceRelease(request, ops), /WRITE_STATE_RECONCILIATION/);
  assert.equal(f.calls.includes('migrateExactPlan'), false); assert.equal(f.calls.includes('unlock'), false);
  assert.equal(f.calls.at(-1), 'recordReconciliationRequired');
});
test('post-resume failure blocks candidate and retains hold/lock rather than resuming baseline', async () => {
  const f = fixture('verifyPublicAcceptance'); const ops = await bindARouteHostOperations(f);
  await assert.rejects(runARouteMaintenanceRelease(request, ops), /DATABASE_RECOVERY_REQUIRED/);
  assert.ok(f.calls.includes('blockCandidateWriters')); assert.equal(f.calls.includes('resumeUnchangedBaselineCancellation'), false);
  assert.equal(f.calls.includes('hold:clear'), false); assert.equal(f.calls.includes('unlock'), false);
});
test('pre-DDL failure resumes only verified unchanged baseline and clears by CAS', async () => {
  const f = fixture('captureAndVerifyCurrentEpochRecovery'); const ops = await bindARouteHostOperations(f);
  await assert.rejects(runARouteMaintenanceRelease(request, ops), /injected failure/);
  assert.deepEqual(f.calls.slice(-6), ['verifyNoMigrationCommitted','resumeUnchangedBaselineCancellation','verifyBaselineCancellation','hold:clear','hold:read','unlock']);
});
test('clear readback failure never claims release success', async () => {
  const f = fixture(); const ops = await bindARouteHostOperations(f);
  f.mutateRead(value => value.state === 'cleared' ? { ...value, sha256: 'e'.repeat(64) } : value);
  await assert.rejects(runARouteMaintenanceRelease(request, ops), /WRITE_STATE_RECONCILIATION/);
  assert.equal(f.calls.includes('unlock'), false); assert.equal(f.calls.at(-1), 'recordReconciliationRequired');
});
test('callback snapshot prevents implementation replacement during admission', async () => {
  const f = fixture(); f.assertProtectedInputs = async () => { f.actions.resumeExactCandidateWriters = async () => { throw Error('replaced'); }; };
  const ops = await bindARouteHostOperations(f); await ops.resumeExactCandidateWriters(identity);
  assert.deepEqual(f.calls, ['resumeExactCandidateWriters']);
});
