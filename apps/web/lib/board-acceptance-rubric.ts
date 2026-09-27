import { boardAcceptanceMatrix, requiredBoardAcceptanceLanes, type BoardAcceptanceLane } from '../scripts/board-acceptance-matrix.mjs';
export type { BoardAcceptanceLane } from '../scripts/board-acceptance-matrix.mjs';
export const BOARD_ACCEPTANCE_RUBRIC = {
  version: 2,
  journeys: ['brainstorm', 'organize', 'panel', 'diagram', 'visual-research', 'ai-ready'] as const,
  metrics: {ttfiMs: 5000, tenStickiesMs: 30000, organizeActions: 2, connectionActions: 2, screenshotPasteActions: 1, aiClusterActions: 2},
  performance: {objectCounts: [1000, 5000, 10000] as const, requiredMeasurements: ['coldRenderMs', 'warmRenderMs', 'viewportP95Ms', 'selectionP95Ms', 'convergenceP95Ms', 'reconnectMs', 'peakHeapBytes', 'retainedHeapBytes', 'longTasks', 'wsBytes', 'queueDepth', 'renderedVisible'] as const},
  soak: {clients: 50, writers: 20, durationMs: 30 * 60 * 1000, convergenceP95Ms: 300},
  requiredLanes: requiredBoardAcceptanceLanes,
} as const;
export interface BoardLaneEvidence {
  lane: BoardAcceptanceLane; sha: string; buildSha: string; dirty: boolean; status: string;
  command: string; startedAt: string; endedAt: string; exitCode: number;
  environment: string; artifactSha256: string; counterproof: boolean;
}
/** Metadata validation is necessary, never sufficient to award an experience score. */
export function evaluateBoardAcceptance(sha: string, rows: readonly BoardLaneEvidence[]) {
  const failures: string[] = [];
  if (!/^[a-f0-9]{40}$/.test(sha)) failures.push('INVALID_SHA');
  for (const lane of requiredBoardAcceptanceLanes) {
    const matching = rows.filter(value => value.lane === lane);
    if (matching.length !== 1) { failures.push(matching.length ? `DUPLICATE:${lane}` : `MISSING:${lane}`); continue; }
    const row = matching[0]!;
    if (row.sha !== sha || row.buildSha !== sha || row.dirty !== false) failures.push(`IDENTITY_MISMATCH:${lane}`);
    if (row.status !== 'passed' || row.exitCode !== 0) failures.push(`NOT_PASSED:${lane}`);
    if (row.counterproof !== true) failures.push(`NO_COUNTERPROOF:${lane}`);
    if (!row.command?.trim() || !row.environment?.trim()) failures.push(`MISSING_CONTEXT:${lane}`);
    const start = Date.parse(row.startedAt), end = Date.parse(row.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) failures.push(`INVALID_TIME:${lane}`);
    if (!/^[a-f0-9]{64}$/.test(row.artifactSha256)) failures.push(`INVALID_ARTIFACT:${lane}`);
  }
  for (const row of rows) if (!requiredBoardAcceptanceLanes.includes(row.lane)) failures.push(`UNKNOWN:${row.lane}`);
  // Each real producer must be wired and reviewed before this gate can approve.
  for (const entry of boardAcceptanceMatrix) if (!entry.command) failures.push(`PRODUCER_NOT_INTEGRATED:${entry.lane}`);
  return {approved: false, score: null, metadataValid: !failures.some(value => !value.startsWith('PRODUCER_NOT_INTEGRATED:')), failures};
}
