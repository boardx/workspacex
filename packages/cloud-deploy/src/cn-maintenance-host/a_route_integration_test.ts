import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindTypedProductionOperations } from './typed_operations';
import { runHostMaintenance, type HostBinding, type HostPrimitives } from './controller';
import type { ARouteHostActions } from './a_route_adapter';
const identity = { sourceRevision: '9b25bfa65662b96c0826fe67506b562ea46aa6d0', baselineRevision: 'ba6343199f3c834d6a198f83d0c771614292c82b', migrationPlanSha256: 'c'.repeat(64), attemptId: 'cloud-integration' };
const binding: HostBinding = { identity, writerPlanPath: '/etc/workspacex-cn/plan.json', writerPlanSha256: 'd'.repeat(64), writerPlanCanonicalSha256: 'e'.repeat(64), hold: { path: '/usr/local/lib/workspacex-cn/cn_maintenance_hold.py', sha256: 'f'.repeat(64) }, writerFence: { path: '/usr/local/lib/workspacex-cn/writer_fence.py', sha256: '1'.repeat(64) } };
const names = ['prepareOffline','verifyPreholdRecoveryCapability','verifyIsolatedCandidateAcceptance','blockAllWrites','verifyWritesBlocked','captureAndVerifyCurrentEpochRecovery','verifyCurrentEpochIsolatedCandidateAcceptance','migrateExactPlan','verifyHeldCandidateReadback','stageCandidateRuntime','verifyCandidateRuntimeIdentity','persistCandidateResumeIntent','resumeExactCandidateWriters','verifyCandidateWritersResumed','verifyPublicAcceptance','observeOpenedCandidate','blockCandidateWriters','verifyNoMigrationCommitted','resumeUnchangedBaselineCancellation','verifyBaselineCancellation','recordRecoveryRequired','recordReconciliationRequired'] as const;
function fixture() {
 const calls: string[] = []; let state='held';
 const actions = Object.fromEntries(names.map(k=>[k,async()=>{calls.push(k);}])) as unknown as ARouteHostActions;
 actions.acquireReleaseLock=async()=>{calls.push('lock');return async()=>{calls.push('unlock');};};
 const record=()=>({schemaVersion:1,state,generation:'2'.repeat(32),sha256:'3'.repeat(64),device:1,inode:2,identity});
 const run=async(_command:unknown,args:readonly string[],data?:unknown)=>{calls.push('hold:'+args[0]);if(args[0]==='clear'){assert.deepEqual(data,record());state='cleared';}return {stdout:JSON.stringify(record())};};
 return {calls,actions,run};
}
test('typed A-route dispatch uses held-readback and candidate resume before acceptance with no legacy activation',async()=>{
 const f=fixture();
 const bound=await bindTypedProductionOperations({aRouteInputs:{binding,actions:f.actions,run:f.run,assertProtectedInputs:async()=>{f.calls.push('profile');}}});
 const legacy=async()=>{throw Error('LEGACY_PATH_REACHED');};
 const primitives:HostPrimitives={...bound,assertTrustedBinding:async()=>{f.calls.push('trust');},verifyRecoveryExecutorCapability:async()=>{f.calls.push('recovery-capability');},acquireReleaseLock:legacy,prepareOffline:legacy,verifyThreeDatabaseRecovery:legacy,migrateExactPlan:legacy,verifyProductionDynamic:legacy,verifyPreactivate:legacy,activate:legacy,verifyAcceptance:legacy};
 await runHostMaintenance({...identity,maintenanceOptIn:'stop-all-writes-and-require-database-recovery'},binding,primitives,f.run);
 assert.ok(f.calls.indexOf('verifyHeldCandidateReadback')<f.calls.indexOf('resumeExactCandidateWriters'));
 assert.ok(f.calls.indexOf('verifyCandidateWritersResumed')<f.calls.indexOf('verifyPublicAcceptance'));
 assert.deepEqual(f.calls.slice(-3),['hold:read','observeOpenedCandidate','unlock']);
});
test('missing actual candidate resume aborts typed admission before lock or hold',async()=>{
 const f=fixture();delete (f.actions as Partial<ARouteHostActions>).resumeExactCandidateWriters;
 await assert.rejects(bindTypedProductionOperations({aRouteInputs:{binding,actions:f.actions,run:f.run,assertProtectedInputs:async()=>{f.calls.push('profile');}}}),/A_ROUTE_HOST_CAPABILITY_MISSING:resumeExactCandidateWriters/);
 assert.deepEqual(f.calls,[]);
});

test('post-migration recovery disposition keeps the actual controller process alive',async()=>{
 const {spawnSync}=await import('node:child_process');
 const script=`import {runHostMaintenanceRetainingFd9} from './packages/cloud-deploy/src/cn-maintenance-host/controller.ts';import {MaintenanceRecoveryRequired} from './packages/cloud-deploy/src/cn-maintenance-release.ts';const id=${JSON.stringify(identity)};const binding=${JSON.stringify(binding)};const names=${JSON.stringify(names)};const ops=Object.fromEntries(names.map(n=>[n,async()=>{}]));Object.assign(ops,{acquireReleaseLock:async()=>async()=>{},persistMaintenanceHold:async()=>{},verifyMaintenanceHoldPresent:async()=>{},clearAndVerifyMaintenanceHold:async()=>{},observeOpenedCandidate:async()=>{},migrateExactPlan:async()=>{throw Error('local-post-ddl-fixture');}});await runHostMaintenanceRetainingFd9({...id,maintenanceOptIn:'stop-all-writes-and-require-database-recovery'},binding,{aRoute:ops,assertTrustedBinding:async()=>{},verifyRecoveryExecutorCapability:async()=>{}},async()=>{throw Error('legacy forbidden');});`;
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:new URL('../../../../',import.meta.url),encoding:'utf8',timeout:2000});
 assert.equal((result.error as NodeJS.ErrnoException | undefined)?.code,'ETIMEDOUT');assert.match(result.stderr,/MAINTENANCE_DATABASE_RECOVERY_REQUIRED_LOCK_RETAINED/);
});
