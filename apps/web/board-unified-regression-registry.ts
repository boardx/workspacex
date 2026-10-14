/** CI and the targeted fresh runtime share one exact list; native suites stay separate. */
export const BOARD_UNIFIED_REGRESSION_SPECS = [
  'board-connector-fast-snap.spec.ts',
  'board-download.spec.ts',
  'board-edge-pan.spec.ts',
  'board-free-connector-snap.spec.ts',
  'board-library-thumbnail.spec.ts',
  'board-menu-layout.spec.ts',
  'board-multi-image-upload.spec.ts',
  'board-viewport-persistence.spec.ts',
  'board-widget-keyboard.spec.ts',
] as const;
