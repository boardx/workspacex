import { MaintenanceRecoveryRequired, MaintenanceWriteStateUnknown, type MaintenanceIdentity, type MaintenanceRequest } from '../cn-maintenance-release';

/** The A route requires independent prehold capability and current held-epoch
 * evidence. No production implementation is inferred from receipt booleans. */
export interface ARouteOperations {
 acquireReleaseLock(identity: MaintenanceIdentity): Promise<() => Promise<void>>;
 prepareOffline(identity: MaintenanceIdentity): Promise<void>;
 verifyPreholdRecoveryCapability(identity: MaintenanceIdentity): Promise<void>;
 verifyIsolatedCandidateAcceptance(identity: MaintenanceIdentity): Promise<void>;
 persistMaintenanceHold(identity: MaintenanceIdentity): Promise<void>;
 verifyMaintenanceHoldPresent(identity: MaintenanceIdentity): Promise<void>;
 blockAllWrites(identity: MaintenanceIdentity): Promise<void>;
 verifyWritesBlocked(identity: MaintenanceIdentity): Promise<void>;
 captureAndVerifyCurrentEpochRecovery(identity: MaintenanceIdentity): Promise<void>;
 /** Repeat six candidate journeys against the freshly restored A2 artifacts. */
 verifyCurrentEpochIsolatedCandidateAcceptance(identity: MaintenanceIdentity): Promise<void>;
 migrateExactPlan(identity: MaintenanceIdentity): Promise<void>;
 verifyHeldCandidateReadback(identity: MaintenanceIdentity): Promise<void>;
 stageCandidateRuntime(identity: MaintenanceIdentity): Promise<void>;
 verifyCandidateRuntimeIdentity(identity: MaintenanceIdentity): Promise<void>;
 persistCandidateResumeIntent(identity: MaintenanceIdentity): Promise<void>;
 resumeExactCandidateWriters(identity: MaintenanceIdentity): Promise<void>;
 verifyCandidateWritersResumed(identity: MaintenanceIdentity): Promise<void>;
 verifyPublicAcceptance(identity: MaintenanceIdentity): Promise<void>;
 observeOpenedCandidate(identity: MaintenanceIdentity): Promise<void>;
 blockCandidateWriters(identity: MaintenanceIdentity): Promise<void>;
 /** Fresh no-DDL proof and unchanged baseline identity, never a cached prior. */
 verifyNoMigrationCommitted(identity: MaintenanceIdentity): Promise<void>;
 resumeUnchangedBaselineCancellation(identity: MaintenanceIdentity): Promise<void>;
 verifyBaselineCancellation(identity: MaintenanceIdentity): Promise<void>;
 clearAndVerifyMaintenanceHold(identity: MaintenanceIdentity): Promise<void>;
 recordRecoveryRequired(identity: MaintenanceIdentity): Promise<void>;
 recordReconciliationRequired(identity: MaintenanceIdentity): Promise<void>;
}
export async function runARouteMaintenanceRelease(request: MaintenanceRequest, ops: ARouteOperations): Promise<void> {
 if(request.maintenanceOptIn!=='stop-all-writes-and-require-database-recovery'||!/^[a-f0-9]{40}$/.test(request.sourceRevision)||!/^[a-f0-9]{40}$/.test(request.baselineRevision)||!/^[a-f0-9]{64}$/.test(request.migrationPlanSha256)||!/^[A-Za-z0-9-]{1,128}$/.test(request.attemptId))throw Error('A_ROUTE_IDENTITY_INVALID');
 for(const name of ['acquireReleaseLock','prepareOffline','verifyPreholdRecoveryCapability','verifyIsolatedCandidateAcceptance','persistMaintenanceHold','verifyMaintenanceHoldPresent','blockAllWrites','verifyWritesBlocked','captureAndVerifyCurrentEpochRecovery','verifyCurrentEpochIsolatedCandidateAcceptance','migrateExactPlan','verifyHeldCandidateReadback','stageCandidateRuntime','verifyCandidateRuntimeIdentity','persistCandidateResumeIntent','resumeExactCandidateWriters','verifyCandidateWritersResumed','verifyPublicAcceptance','observeOpenedCandidate','blockCandidateWriters','verifyNoMigrationCommitted','resumeUnchangedBaselineCancellation','verifyBaselineCancellation','clearAndVerifyMaintenanceHold','recordRecoveryRequired','recordReconciliationRequired'] as const)if(typeof ops[name]!=='function')throw Error('A_ROUTE_CAPABILITY_MISSING:'+name);
 const identity=Object.freeze({sourceRevision:request.sourceRevision,baselineRevision:request.baselineRevision,migrationPlanSha256:request.migrationPlanSha256,attemptId:request.attemptId});
 const release=await ops.acquireReleaseLock(identity);
 let holdIntent=false,migrationIntent=false,resumeIntent=false,retainLock=false,holdCleared=false;
 try{
  await ops.prepareOffline(identity);
  await ops.verifyPreholdRecoveryCapability(identity);
  await ops.verifyIsolatedCandidateAcceptance(identity);
  holdIntent=true;await ops.persistMaintenanceHold(identity);
  await ops.verifyMaintenanceHoldPresent(identity);
  await ops.blockAllWrites(identity);await ops.verifyWritesBlocked(identity);
  // This receipt is produced after drain and belongs to this exact hold epoch.
  await ops.captureAndVerifyCurrentEpochRecovery(identity);
  await ops.verifyCurrentEpochIsolatedCandidateAcceptance(identity);
  migrationIntent=true;await ops.migrateExactPlan(identity);
  await ops.verifyHeldCandidateReadback(identity);
  await ops.stageCandidateRuntime(identity);await ops.verifyCandidateRuntimeIdentity(identity);
  // Intent is durable before any new writer can start; a lost reply is unknown.
  resumeIntent=true;await ops.persistCandidateResumeIntent(identity);
  await ops.resumeExactCandidateWriters(identity);await ops.verifyCandidateWritersResumed(identity);
  await ops.verifyPublicAcceptance(identity);
  await ops.clearAndVerifyMaintenanceHold(identity);holdCleared=true;
  await ops.observeOpenedCandidate(identity);holdIntent=false;
 }catch(error){
  if(!holdIntent)throw error;
  retainLock=true;
  try{
   // A lost clear reply can leave the hold cleared. Hold reconciliation must
   // never prevent an independent attempt to stop resumed candidate writers.
   let recoveryUnknown=false;
   try{
    if(holdCleared)await ops.persistMaintenanceHold(identity);
    await ops.verifyMaintenanceHoldPresent(identity);
   }catch{recoveryUnknown=true;}
   try{
    if(resumeIntent)await ops.blockCandidateWriters(identity);
    await ops.verifyWritesBlocked(identity);
   }catch{recoveryUnknown=true;}
   if(recoveryUnknown)throw Error('A_ROUTE_RECOVERY_STATE_UNKNOWN');
  }catch{
   try{await ops.recordReconciliationRequired(identity);}catch{/* retain lock */}
   throw new MaintenanceWriteStateUnknown();
  }
  if(!migrationIntent){
   try{
    await ops.verifyNoMigrationCommitted(identity);
    await ops.resumeUnchangedBaselineCancellation(identity);
    await ops.verifyBaselineCancellation(identity);
    await ops.clearAndVerifyMaintenanceHold(identity);
    holdIntent=false;retainLock=false;
   }catch{
    try{await ops.recordReconciliationRequired(identity);}catch{/* retain lock */}
    throw new MaintenanceWriteStateUnknown();
   }
   throw error;
  }
  // Even a failed migrate response may follow committed SQL. Never resume prior.
  try{await ops.recordRecoveryRequired(identity);}catch{/* retain lock */}
  throw new MaintenanceRecoveryRequired();
 }finally{if(!retainLock)await release();}
}
