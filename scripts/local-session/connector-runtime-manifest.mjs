import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { sourceFiles as navigationSources } from './board-navigation-acceptance-runtime.mjs';
import { runtimeSourceHashes as hashSources, committedRuntimeSourceHashes, verifyRuntimeManifest as verifyBase } from './board-acceptance-runtime.mjs';
export { savedSequence, descendsFrom } from './board-acceptance-runtime.mjs';

const connectorSources = [
  "apps/web/components/whiteboard/live-board.tsx",
  "packages/whiteboard-core/src/index.ts",
  "scripts/local-session/board-connector-capability-acceptance.mjs",
  "scripts/local-session/connector-cancellation-classifier.mjs",
  "apps/web/components/whiteboard/collaborative-thinking-editor.tsx",
  "apps/web/components/whiteboard/use-board-toolbar-position.ts",
  "apps/web/components/whiteboard/use-board-connector-gesture.ts",
  "apps/web/components/whiteboard/connector-gesture.ts",
  "apps/web/components/whiteboard/board-connector-handles.tsx",
  "apps/web/components/whiteboard/board-editor-header.tsx",
  "apps/web/components/whiteboard/board-selected-object-panel.tsx",
  "apps/web/components/whiteboard/fabric/connector-interaction.ts",
  "apps/web/components/whiteboard/board-connector-toolbar.tsx",
  "apps/web/components/whiteboard/object-context-toolbar.tsx",
  "apps/web/components/whiteboard/board-tool-popover.tsx",
  "apps/web/components/whiteboard/board-connector-preview.tsx",
  "apps/web/components/whiteboard/board-connector-picker.tsx",
  "apps/web/components/whiteboard/fabric/board-fabric-object.ts",
  "apps/web/components/whiteboard/board-bottom-dock.tsx",
  "apps/web/components/whiteboard/fabric/board-fabric-surface.tsx",
  "packages/contracts/src/whiteboard-document.ts",
  "packages/whiteboard-core/src/connector-path.ts",
  "packages/whiteboard-core/src/spatial-relationships.ts",
  "packages/whiteboard-core/src/thinking-input.ts",
  "packages/whiteboard-core/src/connector-snap.ts",
  "apps/web/components/whiteboard/whiteboard-fabric-projection.ts",
  "apps/web/components/whiteboard/fabric/board-fabric-visual.ts",
  "scripts/local-session/board-connector-late-target-acceptance.mjs",
  "packages/contracts/src/whiteboard-sync.ts",
  "packages/whiteboard-core/src/document.ts",
  "apps/web/lib/whiteboard-provider.ts",
  "scripts/local-session/board-connector-matrix-acceptance.mjs",
  "scripts/local-session/connector-runtime-manifest.mjs"
];
export const acceptedNavigationBases = ['48a96cbe2e68f49167b9da54a4d9d44fd0c80b28','5be0a4ef63868d58e2f6b8c8d8d7bb37fbef967d'];
export const sourceFiles = [...new Set([...navigationSources,...connectorSources,
  'scripts/local-session/connector-acceptance-plan.mjs',
  'apps/web/components/whiteboard/thinking-input-editor.tsx',
])];
export const runtimeSourceHashes = root => hashSources(root,sourceFiles);

// This pure source gate also rejects a freshly regenerated manifest of dirty bytes.
export function assertCommittedSource({root,head,hashes,files=sourceFiles}) {
  assert.equal(head,execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),'attested HEAD must remain current');
  assert.deepEqual(hashes,hashSources(root,files),'runtime startup source must match current candidate');
  assert.deepEqual(hashes,committedRuntimeSourceHashes(root,head,files),'runtime source must match exact attested commit, not matching dirty source');
}
export function verifyRuntimeManifest(options) {
  assert(options.manifestPath,'Explicit candidate runtime manifest required');
  const manifest=JSON.parse(readFileSync(options.manifestPath,'utf8'));
  for(const base of acceptedNavigationBases) {
    try { execFileSync('git',['merge-base','--is-ancestor',base,manifest.head],{cwd:options.root,stdio:'pipe'}); }
    catch { assert.fail('candidate must descend from accepted navigation source and evidence: '+base); }
  }
  assertCommittedSource({root:options.root,head:manifest.head,hashes:manifest.sourceHashes});
  return {...verifyBase({...options,sourceFiles}),acceptedNavigationBases};
}
