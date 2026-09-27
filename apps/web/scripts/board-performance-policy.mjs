import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
export function boardPerformancePolicy(root) {
  const baselinePath = 'docs/design/whiteboard/requirements.md';
  const baseline = readFileSync(resolve(root, baselinePath), 'utf8');
  const collaborationPath = 'phases/phase-19-board-visual-workspace/requirements/05-collaboration-history.md';
  const collaboration = readFileSync(resolve(root, collaborationPath), 'utf8');
  const number = (text, regex, name) => {const found = text.match(regex); if (!found) throw new Error(`PERFORMANCE_POLICY_SOURCE_CHANGED:${name}`); return Number(found[1]);};
  return {
    baseline: {source: `${baselinePath}#R9`, status: 'proposed-baseline-used-as-current-engineering-target-not-human-signoff', applicableObjectCounts: [5000],
      coldLoadP95Ms: number(baseline, /非缓存进入基准板 p95 ≤(\d+) 秒/, 'cold') * 1000,
      localFeedbackP95Ms: number(baseline, /本地键入\/拖动响应 p95 ≤(\d+)ms/, 'feedback'),
      dragFpsMinimum: number(baseline, /持续拖动帧率 ≥(\d+)fps/, 'fps'),
      reconnectMs: number(baseline, /恢复网络后 (\d+) 秒内收敛/, 'recovery') * 1000},
    convergence: {source: `${collaborationPath}#R9`, p95Ms: number(collaboration, /同步 p95 ≤(\d+)ms/, 'convergence'),
      scope: 'two-peer engineering check; does not replace 50-client 30-minute soak'},
    unbudgetedObjectCounts: [1000, 10000],
  };
}
export const percentile95 = samples => {
  if (!Array.isArray(samples) || !samples.length || samples.some(value => !Number.isFinite(value) || value < 0)) throw new Error('INVALID_PERFORMANCE_SAMPLES');
  const sorted = [...samples].sort((a, b) => a - b); return sorted[Math.ceil(sorted.length * .95) - 1];
};
/** Validate the producer's observed artifact; a measurement report alone never awards 9/10. */
export function validateBoardPerformanceArtifact(report, policy, expectedSha, expectedCount) {
  const failures = [];
  if (report?.version !== 1 || report.objectCount !== expectedCount || ![1000, 5000, 10000].includes(expectedCount)) failures.push('DATASET_COUNT');
  const identity = report?.runtimeIdentity;
  if (!identity || identity.sha !== expectedSha || identity.buildSha !== expectedSha || identity.dirty !== false
    || identity.method !== 'fresh-server-marker-and-built-chunk-hashes' || !identity.deploymentMarker
    || !identity.buildId || !Array.isArray(identity.chunks) || identity.chunks.length === 0
    || identity.chunks.some(value => !/^[a-f0-9]{64}$/.test(value.sha256) || value.sha256 !== value.localSha256)
    || !Number.isFinite(Date.parse(identity.runStartedAt)) || !Number.isFinite(Date.parse(identity.buildCreatedAt))
    || Date.parse(identity.buildCreatedAt) < Date.parse(identity.runStartedAt)) failures.push('RUNTIME_IDENTITY');
  if (!/^[a-f0-9]{64}$/.test(report?.datasetHash ?? '') || report?.apiObjectCount !== expectedCount) failures.push('DATASET_IDENTITY');
  for (const kind of ['sticky', 'text', 'rectangle', 'frame', 'connector', 'image', 'extension']) if (!(report?.kindCounts?.[kind] > 0)) failures.push(`MISSING_KIND:${kind}`);
  if (Object.values(report?.kindCounts ?? {}).reduce((sum, value) => sum + Number(value), 0) !== expectedCount) failures.push('KIND_TOTAL');
  for (const key of ['coldLoadMs', 'warmLoadMs', 'panFrameMs', 'zoomFrameMs', 'dragFrameMs', 'dragFeedbackMs', 'textFeedbackMs', 'selectionMs', 'layoutMs', 'convergenceMs', 'reconnectMs', 'heapBytes', 'renderedVisible']) {
    const samples = report?.samples?.[key];
    if (!Array.isArray(samples) || samples.length < (['coldLoadMs', 'warmLoadMs'].includes(key) ? 5 : 1) || samples.some(value => !Number.isFinite(value) || value < 0)) failures.push(`MISSING_SAMPLES:${key}`);
  }
  if (!Number.isFinite(report?.retainedHeapBytes) || report.retainedHeapBytes <= 0 || !Array.isArray(report?.longTasks)) failures.push('MISSING_MEMORY_OR_LONG_TASKS');
  if (!(report?.transport?.bytesSent > 0) || !(report?.transport?.bytesReceived > 0) || !(report?.transport?.ackCount > 0)
    || !Number.isInteger(report?.transport?.peakPending) || report.transport.pendingAtEnd !== 0 || report.transport.errors?.length) failures.push('TRANSPORT_EVIDENCE');
  if (report?.peerConverged !== true || report?.reloadConverged !== true || report?.durableImagesVerified !== true) failures.push('CONTENT_CONVERGENCE');
  if (report?.loadTraces?.length !== 5 || report.loadTraces.some(trace => !/^[a-f0-9]{64}$/.test(trace?.sha256 ?? '') || !trace?.path)) failures.push('LOAD_TRACES');
  if (!/^[a-f0-9]{64}$/.test(report?.trace?.sha256 ?? '') || !report?.trace?.path) failures.push('BROWSER_TRACE');
  if (!failures.length) {
    if (percentile95(report.samples.convergenceMs) > policy.convergence.p95Ms) failures.push('CONVERGENCE_BUDGET');
    if (expectedCount === 5000) {
      if (percentile95(report.samples.coldLoadMs) > policy.baseline.coldLoadP95Ms) failures.push('COLD_LOAD_BUDGET');
      if (percentile95(report.samples.dragFeedbackMs) > policy.baseline.localFeedbackP95Ms || percentile95(report.samples.textFeedbackMs) > policy.baseline.localFeedbackP95Ms) failures.push('LOCAL_FEEDBACK_BUDGET');
      if (1000 / percentile95(report.samples.dragFrameMs) < policy.baseline.dragFpsMinimum) failures.push('DRAG_FPS_BUDGET');
      if (Math.max(...report.samples.reconnectMs) > policy.baseline.reconnectMs) failures.push('RECONNECT_BUDGET');
    }
  }
  return {valid: failures.length === 0, failures, score: null, budgetStatus: expectedCount === 5000 ? 'engineering-targets' : 'measurement-only-unbudgeted', policy};
}
