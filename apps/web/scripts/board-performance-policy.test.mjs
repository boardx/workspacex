import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {boardPerformancePolicy, percentile95, validateBoardPerformanceArtifact} from './board-performance-policy.mjs';
const root = resolve(import.meta.dirname, '../../..'), sha = 'a'.repeat(40), hash = 'b'.repeat(64);
const policy = boardPerformancePolicy(root);
/** Synthetic validator UNIT fixture only; never an acceptance artifact or lane. */
function fixture(count = 5000) {
  return {version: 1, objectCount: count, apiObjectCount: count, datasetHash: hash,
    kindCounts: {sticky: count - 6, text: 1, rectangle: 1, frame: 1, connector: 1, image: 1, extension: 1},
    runtimeIdentity: {sha, buildSha: sha, dirty: false, method: 'fresh-server-marker-and-built-chunk-hashes', deploymentMarker: 'unit',
      buildId: 'unit-only', runStartedAt: '2026-09-27T00:00:00Z', buildCreatedAt: '2026-09-27T00:01:00Z', chunks: [{sha256: hash, localSha256: hash}]},
    samples: {coldLoadMs: [2000, 2001, 2002, 2003, 2004], warmLoadMs: [1000, 1001, 1002, 1003, 1004], panFrameMs: [16, 17], zoomFrameMs: [16, 17],
      dragFrameMs: [16, 17], dragFeedbackMs: [30, 31], textFeedbackMs: [30, 31], selectionMs: [32], layoutMs: [45], convergenceMs: [100, 101],
      reconnectMs: [500], heapBytes: [1_000_000, 1_000_100], renderedVisible: [24, 25]},
    retainedHeapBytes: 800_000, longTasks: [], transport: {bytesSent: 2000, bytesReceived: 3000, ackCount: 20, peakPending: 1, pendingAtEnd: 0, errors: []},
    peerConverged: true, reloadConverged: true, durableImagesVerified: true, loadTraces: Array.from({length: 5}, () => ({path: '/unit-only-never-published', sha256: hash})), trace: {path: '/unit-only-never-published', sha256: hash}};
}
test('budgets come from named repository sources and retain proposed status', () => {
  assert.equal(policy.baseline.coldLoadP95Ms, 5000); assert.equal(policy.baseline.localFeedbackP95Ms, 50);
  assert.equal(policy.baseline.dragFpsMinimum, 30); assert.equal(policy.baseline.reconnectMs, 10000);
  assert.equal(policy.convergence.p95Ms, 300); assert.match(policy.baseline.status, /not-human-signoff/);
  assert.deepEqual(policy.unbudgetedObjectCounts, [1000, 10000]);
});
test('does not manufacture scale budgets or round any performance result to nine', () => {
  assert.equal(validateBoardPerformanceArtifact(fixture(), policy, sha, 5000).valid, true);
  for (const count of [1000, 10000]) {
    const result = validateBoardPerformanceArtifact(fixture(count), policy, sha, count);
    assert.equal(result.valid, true); assert.equal(result.budgetStatus, 'measurement-only-unbudgeted'); assert.equal(result.score, null);
  }
});
test('rejects poor actual samples rather than trusting producer summary flags', () => {
  const report = fixture(); report.samples.coldLoadMs = [1, 1, 1, 1, 6000];
  report.samples.dragFeedbackMs = [51]; report.samples.dragFrameMs = [40]; report.samples.reconnectMs = [10001]; report.samples.convergenceMs = [301];
  const result = validateBoardPerformanceArtifact(report, policy, sha, 5000);
  for (const failure of ['COLD_LOAD_BUDGET', 'LOCAL_FEEDBACK_BUDGET', 'DRAG_FPS_BUDGET', 'RECONNECT_BUDGET', 'CONVERGENCE_BUDGET']) assert.ok(result.failures.includes(failure));
});
test('rejects missing traces, stale runtime, fake image references and undersampled loads', () => {
  const report = fixture(); report.runtimeIdentity.buildSha = 'c'.repeat(40); report.trace.sha256 = 'missing';
  report.durableImagesVerified = false; report.samples.coldLoadMs = [10]; report.transport.pendingAtEnd = 1;
  const result = validateBoardPerformanceArtifact(report, policy, sha, 5000);
  for (const failure of ['RUNTIME_IDENTITY', 'BROWSER_TRACE', 'CONTENT_CONVERGENCE', 'MISSING_SAMPLES:coldLoadMs', 'TRANSPORT_EVIDENCE']) assert.ok(result.failures.includes(failure));
});
test('p95 is nearest-rank over all samples; non-finite/missing observations fail', () => {
  assert.equal(percentile95(Array.from({length: 20}, (_, i) => i + 1)), 19);
  assert.throws(() => percentile95([])); assert.throws(() => percentile95([NaN]));
});
