import {test} from 'vitest';
import assert from 'node:assert/strict';
import {NATIVE_RECEIPTS, verifyNativeReceipts} from './board-native-receipts.mjs';
const sha='a'.repeat(40);
export function completeReceipts() {
  return Object.fromEntries(Object.entries(NATIVE_RECEIPTS).map(([lane,suite])=>[lane,{
    schemaVersion:1,sourceHead:sha,suiteConfig:suite.config,status:'PASSED',actualRuntimeExecution:true,
    requiredSuiteComplete:true,phase:'ACCEPTANCE',errors:0,exitCode:0,failureReason:null,cleanupCompleted:true,
    cleanupFailures:[],runtimeExit:{code:0,signal:null,wasAlive:true},
    statistics:{expected:suite.expected,unexpected:0,flaky:0,skipped:0},
  }]));
}
test('only all three complete executed suites of exact SHA pass',()=>{
  assert.equal(verifyNativeReceipts(completeReceipts(),sha),true);
  for(const lane of Object.keys(NATIVE_RECEIPTS)) {
    for(const patch of [{status:'ABSENT'},{status:'FAILED'},{actualRuntimeExecution:false},{requiredSuiteComplete:false},
      {errors:1},{sourceHead:'b'.repeat(40)},{suiteConfig:'foreign'},{exitCode:1},{failureReason:'ACCEPTANCE_FAILED'},
      {cleanupCompleted:false},{cleanupFailures:['FAILED']},{runtimeExit:{code:0,signal:null,wasAlive:false}},
      {statistics:{expected:NATIVE_RECEIPTS[lane].expected,unexpected:1,flaky:0,skipped:0}},
      {statistics:{expected:NATIVE_RECEIPTS[lane].expected,unexpected:0,flaky:0,skipped:1}},
      {statistics:{expected:0,unexpected:0,flaky:0,skipped:0}},{schemaVersion:undefined}]) {
      const receipts=completeReceipts();Object.assign(receipts[lane],patch);
      assert.throws(()=>verifyNativeReceipts(receipts,sha), `${lane}: ${JSON.stringify(patch)}`);
    }
    const receipts=completeReceipts();delete receipts[lane];assert.throws(()=>verifyNativeReceipts(receipts,sha));
  }
  for(const invalid of [null,{},[],undefined])assert.throws(()=>verifyNativeReceipts(invalid,sha));
});
