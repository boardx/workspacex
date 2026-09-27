/** These lanes are deliberately unavailable until a real producer is integrated.
 * Validator/fixture unit tests are NOT production acceptance commands.
 */
export const boardAcceptanceMatrix = [
  ['journeys', 'Six real journeys with action counts, result assertions and traces'],
  ['performance-1k', 'Real persisted 1k Fabric/Yjs board and thresholded browser measurements'],
  ['performance-5k', 'Real persisted 5k Fabric/Yjs board and thresholded browser measurements'],
  ['performance-10k', 'Real persisted 10k Fabric/Yjs board and thresholded browser measurements'],
  ['collaboration-50', '50 clients, 20 active writers, >=30 minute observed signed ledger'],
  ['storage', 'PostgreSQL metadata/ObjectStore content, corruption and ACK recovery'],
  ['import', 'Miro and Mural imports, losses report and export round trip'],
  ['accessibility', 'Keyboard, screenreader, touch/pen, 200/400% reflow and three browsers'],
  ['security', 'Tenant ACL, revocation, API/WS/ObjectStore negative cases'],
  ['api-ws-objectstore', 'Cross-layer persistence and convergence'],
  ['visual', 'Before/after screenshots at three viewports, >=90/100 and each dimension >=80%, no blockers'],
  ['meeting-room', 'Real meeting-room lifecycle with >=30 minute observed signed ledger'],
].map(([lane, requirement]) => ({lane, requirement, status: 'not-run', command: null,
  reason: 'REAL_PRODUCER_NOT_INTEGRATED'}));
export const requiredBoardAcceptanceLanes = boardAcceptanceMatrix.map(entry => entry.lane);
