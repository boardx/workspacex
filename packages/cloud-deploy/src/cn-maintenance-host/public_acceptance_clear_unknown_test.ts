import test from 'node:test';
import assert from 'node:assert/strict';
import { runARouteMaintenanceRelease, type ARouteOperations } from './a_route';
const request = { sourceRevision: '9'.repeat(40), baselineRevision: 'b'.repeat(40), migrationPlanSha256: 'a'.repeat(64), attemptId: 'clear-unknown', maintenanceOptIn: 'stop-all-writes-and-require-database-recovery' as const };
const names = ['prepareOffline','verifyPreholdRecoveryCapability','verifyIsolatedCandidateAcceptance','blockAllWrites','verifyWritesBlocked','captureAndVerifyCurrentEpochRecovery','verifyCurrentEpochIsolatedCandidateAcceptance','migrateExactPlan','verifyHeldCandidateReadback','stageCandidateRuntime','verifyCandidateRuntimeIdentity','persistCandidateResumeIntent','resumeExactCandidateWriters','verifyCandidateWritersResumed','verifyPublicAcceptance','observeOpenedCandidate','blockCandidateWriters','verifyNoMigrationCommitted','resumeUnchangedBaselineCancellation','verifyBaselineCancellation','recordRecoveryRequired','recordReconciliationRequired'] as const;
for (const failure of ['clear-response-lost', 'clear-readback-lost'] as const) {
 test(failure + ' attempts candidate stop even when hold read fails, retaining lock', async () => {
  const calls: string[] = []; let held = false;
  const ops: any = Object.fromEntries(names.map(name => [name, async () => { calls.push(name); }]));
  ops.acquireReleaseLock = async () => { calls.push('lock'); return async () => { calls.push('unlock'); }; };
  ops.persistMaintenanceHold = async () => { calls.push('hold:create'); if (calls.filter(c => c === 'hold:create').length > 1) throw Error('hold transport unavailable'); held = true; };
  ops.verifyMaintenanceHoldPresent = async () => { calls.push('hold:read'); if (!held) throw Error('cleared or read unavailable'); };
  ops.clearAndVerifyMaintenanceHold = async () => { calls.push('hold:clear'); held = false; if (failure === 'clear-readback-lost') calls.push('clear:readback'); throw Error(failure); };
  await assert.rejects(runARouteMaintenanceRelease(request, ops as ARouteOperations), /WRITE_STATE_RECONCILIATION|DATABASE_RECOVERY_REQUIRED/);
  assert.equal(calls.includes('blockCandidateWriters'), true, 'hold uncertainty must not prevent candidate stop attempt');
  assert.equal(calls.includes('unlock'), false);
  assert.equal(calls.includes('observeOpenedCandidate'), false);
  assert.equal(calls.includes('resumeUnchangedBaselineCancellation'), false);
 });
}
