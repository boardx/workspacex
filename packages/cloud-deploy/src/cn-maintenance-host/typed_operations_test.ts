import { test } from 'node:test';import assert from 'node:assert/strict';
import { bindTypedProductionOperations, type ProtectedOperationInputs } from './typed_operations';
test('aggregates missing real transports before any production operation',async()=>{await assert.rejects(bindTypedProductionOperations({}),error=>{assert.match(String(error),/PROTECTED_OPERATIONS_MISSING/);for(const key of ['replayPreholdRecovery','migrationTransport.migrate','activation.restoreBaseline','activation.runBrowserSmoke','preparedArtifacts'])assert.ok(String(error).includes(key));return true;});});
test('partial receipt never supplies absent migration or recovery implementation',async()=>{let called=false;await assert.rejects(bindTypedProductionOperations({preparedReceipt:{ready:true},preparedManifest:Buffer.from('{}'),assertProtectedInputs:async()=>{called=true;}}),/PROTECTED_OPERATIONS_MISSING/);assert.equal(called,false);});
test('complete legacy methods cannot impersonate supervised activation at startup',async()=>{
 let calls=0;const operation=async()=>{calls++;};
 const value={preparedReceipt:{},preparedManifest:Buffer.from('{}'),migration:{},collector:{},preactivateVerifier:{},release:'fixture',
 verifyOfflineArtifacts:operation,replayPreholdRecovery:operation,verifyCandidateAcceptance:operation,readValidatedReceipt:operation,runBash:operation,assertProtectedInputs:operation,
 migrationTransport:{migrate:operation,readFreshCompletion:operation,verifyLiveWriterBarrier:operation},
 activation:Object.fromEntries(['readBaselineFingerprint','drainRuns','promotePreparedPointer','activateTraffic','verifyCanonical','runBrowserSmoke','restoreBaseline','restorePointer'].map(name=>[name,operation]))} as unknown as ProtectedOperationInputs;
 await assert.rejects(bindTypedProductionOperations(value),/PREPARED_ACTIVATION_SUPERVISED_TRANSPORT_NOT_IMPLEMENTED/);assert.equal(calls,0);
});
