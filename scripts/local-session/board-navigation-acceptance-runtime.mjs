import { runtimeSourceHashes, verifyRuntimeManifest } from './board-acceptance-runtime.mjs';

export const sourceFiles = [
  'apps/api/src/main.ts',
  'apps/api/src/interface/controllers/whiteboard-operation.controller.ts',
  'apps/api/src/interface/ws/whiteboard.gateway.ts',
  'apps/api/src/infrastructure/whiteboard/update-validator-worker.ts',
  'apps/api/src/application/whiteboard/operation-service.ts',
  'apps/web/components/whiteboard/live-board.tsx',
  'apps/web/lib/whiteboard-provider.ts',
  'apps/web/components/whiteboard/collaborative-thinking-editor.tsx',
  'apps/web/components/whiteboard/fabric/board-fabric-surface.tsx',
  'apps/web/components/whiteboard/fabric/fabric-input.ts',
  'apps/web/components/whiteboard/fabric/board-fabric-visual.ts',
  'apps/web/components/whiteboard/fabric/drawing-stroke-path.ts',
  'apps/web/components/whiteboard/fabric/drawing-cache-bounds.ts',
  'apps/web/components/whiteboard/fabric/drawing-hit-test.ts',
  'apps/web/components/whiteboard/drawing-coordinate-space.ts',
  'apps/web/components/whiteboard/drawing-tool-style.ts',
  'apps/web/components/whiteboard/whiteboard-fabric-projection.ts',
  'apps/web/components/whiteboard/object-context-toolbar.tsx',
  'apps/web/components/whiteboard/use-board-toolbar-position.ts',
  'apps/web/components/whiteboard/use-board-overlay-navigation.ts',
  'packages/whiteboard-core/src/index.ts',
  'packages/whiteboard-core/src/document.ts',
  'packages/whiteboard-core/src/spatial-relationships.ts',
  'packages/whiteboard-core/src/content-object-model.ts',
  'packages/contracts/src/whiteboard-operation.ts',
  'scripts/local-session/board-navigation-acceptance.mjs',
  'scripts/local-session/board-navigation-acceptance-classifier.mjs',
  'scripts/local-session/board-navigation-acceptance-scheduler.mjs',
  'scripts/local-session/board-navigation-acceptance-runtime.mjs',
  'scripts/local-session/board-acceptance-runtime.mjs',
];

export const navigationSourceHashes = root => runtimeSourceHashes(root, sourceFiles);
export const verifyNavigationRuntime = options => verifyRuntimeManifest({ ...options, sourceFiles });
