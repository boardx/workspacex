export const boardAcceptanceMatrix = [
  {lane:'journeys',command:['pnpm','--filter','web','exec','playwright','test','--config','e2e/board-three-browsers.config.ts','e2e/board-final-acceptance.spec.ts']},
  {lane:'performance-1k',command:['pnpm','--filter','web','exec','vitest','run','tests/performance/board-fabric-5k-mixed.test.ts']},
  {lane:'performance-5k',command:['pnpm','--filter','web','exec','vitest','run','tests/performance/board-fabric-5k-mixed.test.ts']},
  {lane:'performance-10k',command:['pnpm','--filter','web','exec','vitest','run','tests/performance/board-fabric-10k-report.test.ts']},
  {lane:'collaboration-50',command:['pnpm','--filter','api','exec','vitest','run','--config','vitest.whiteboard-unit.config.ts','tests/whiteboard/collaboration-50-browser-soak-ledger.test.ts','tests/whiteboard/recovery-revoke-blob-ledger.test.ts']},
  {lane:'storage',command:['pnpm','--filter','web','exec','playwright','test','--config','e2e/board-three-browsers.config.ts','e2e/board-import-storage.spec.ts']},
  {lane:'import',command:['pnpm','--filter','web','exec','playwright','test','--config','e2e/board-three-browsers.config.ts','e2e/board-import-storage.spec.ts']},
  {lane:'accessibility',command:['pnpm','--filter','web','exec','playwright','test','--config','e2e/board-three-browsers.config.ts','e2e/board-accessibility-input.spec.ts']},
  {lane:'security',command:['pnpm','--filter','web','exec','playwright','test','--config','e2e/board-three-browsers.config.ts','e2e/board-security.spec.ts']},
  {lane:'api-ws-objectstore',command:['pnpm','--filter','web','exec','playwright','test','--config','e2e/board-three-browsers.config.ts','e2e/board-collaboration-load.spec.ts','e2e/board-security.spec.ts']},
];
