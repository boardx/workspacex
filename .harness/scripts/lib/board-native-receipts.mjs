/** Success requires the three complete native measurements of this exact source. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const NATIVE_SUITE_DEFINITIONS={
  'e2e/board-connector-existing-runtime.config.ts':{count:7,files:['board-connector-authority.spec.ts','board-connector-copy-defaults.spec.ts','board-connector-history.spec.ts','board-connector-independent-process.spec.ts','board-connector-interchange.spec.ts']},
  'e2e/board-files-completion.config.ts':{count:6,files:['board-files-boundaries.spec.ts','board-files-filenames.spec.ts','board-files-placement.spec.ts','board-files-retry.spec.ts']},
  'e2e/board-peer-existing-runtime.config.ts':{count:4,metadata:'apps/web/e2e/support/r08/r08-native-suite.json'},
};
export const NATIVE_RECEIPTS = Object.fromEntries(['connectors', 'files', 'sync'].map((lane, index) => {
  const [config, definition] = Object.entries(NATIVE_SUITE_DEFINITIONS)[index];
  return [lane, {config, expected: definition.count}];
}));
export function nativeReceiptVerdict(receipts, sha) {
  let verdict = 'success';
  assert.match(sha, /^[a-f0-9]{40}$/);
  for (const [lane, suite] of Object.entries(NATIVE_RECEIPTS)) {
    const receipt = receipts?.[lane];
    assert.equal(receipt?.schemaVersion, 1, `${lane}: missing/versioned receipt`);
    assert.equal(receipt.sourceHead, sha, `${lane}: source SHA mismatch`);
    assert.equal(receipt.suiteConfig, suite.config, `${lane}: suite mismatch`);
    if (receipt.status === 'FAILED') {
      assert.equal(typeof receipt.failureReason, 'string');
      assert(receipt.failureReason.length > 0);
      assert.equal(receipt.requiredSuiteComplete, false);
      assert.equal(typeof receipt.actualRuntimeExecution, 'boolean');
      assert(['PREPARE', 'STARTUP', 'ACCEPTANCE'].includes(receipt.phase));
      verdict = 'failure';
      continue; // Retain a real failure; never promote it to successful acceptance.
    }
    assert.equal(receipt.status, 'PASSED', `${lane}: original verdict is not passed`);
    assert.equal(receipt.actualRuntimeExecution, true, `${lane}: runtime not executed`);
    assert.equal(receipt.requiredSuiteComplete, true, `${lane}: incomplete suite`);
    assert.equal(receipt.phase, 'ACCEPTANCE');
    assert.equal(receipt.exitCode, 0);
    assert.equal(receipt.errors, 0);
    assert.equal(receipt.failureReason, null);
    assert.equal(receipt.cleanupCompleted, true);
    assert.deepEqual(receipt.cleanupFailures, []);
    assert.deepEqual(receipt.runtimeExit, {code: 0, signal: null, wasAlive: true});
    assert.deepEqual(receipt.statistics, {expected: suite.expected, unexpected: 0, flaky: 0, skipped: 0});
  }
  return verdict;
}
export function verifyNativeReceipts(receipts, sha) {
  assert.equal(nativeReceiptVerdict(receipts, sha), 'success', 'Native measurement failed');
  return true;
}
export function readNativeReceipts(directory) {
  return Object.fromEntries(Object.keys(NATIVE_RECEIPTS).map(lane => [lane, JSON.parse(readFileSync(join(directory, lane, 'receipt.json'), 'utf8'))]));
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { verifyNativeReceipts(readNativeReceipts(process.argv[2]), process.argv[3]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
