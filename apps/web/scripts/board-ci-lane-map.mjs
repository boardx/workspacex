/**
 * A workflow job may run one real producer that emits evidence for more than
 * one canonical acceptance lane. Keep that fan-out explicit so a retained CI
 * result can be composed into the exact 12-lane acceptance matrix without
 * guessing from job names.
 */
export const boardCiLaneMap = Object.freeze({
  journeys: Object.freeze(['journeys']),
  security: Object.freeze(['security']),
  visual: Object.freeze(['visual', 'accessibility']),
  storage: Object.freeze(['storage']),
  import: Object.freeze(['import']),
  'api-ws-objectstore': Object.freeze(['api-ws-objectstore']),
  performance: Object.freeze(['performance-1k', 'performance-5k', 'performance-10k']),
  'collaboration-50': Object.freeze(['collaboration-50']),
  'meeting-room': Object.freeze(['meeting-room']),
});

export const boardCiLanes = Object.freeze(Object.keys(boardCiLaneMap));

export function canonicalLanesForBoardCiLane(lane) {
  const lanes = boardCiLaneMap[lane];
  if (!lanes) throw new Error('UNKNOWN_BOARD_CI_LANE');
  return lanes;
}
