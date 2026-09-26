# Board Iteration 05 second-review closure

The second independent review findings are closed in this change:

- ActiveSelection move, scale, and rotation are written from each member's total Fabric scene matrix and total angle, then committed through one canonical transform command.
- Panel hit-testing follows the actual Fabric visual stack and chooses the topmost overlapping Panel.
- Bring Forward and Send Backward move one visual layer. Locked siblings retain their own lock and `zIndex`; only unlocked records are relabelled, and the resulting order is unique.
- Duplicate closure includes a connector only when it has at least one attached endpoint and every attached endpoint is inside the copied closure. Unrelated free-to-free connectors stay outside.
- Multi-object deletion has one preflight and one canonical batch for both cascade and preserve-as-free strategies. A locked connector or invalid container rejects the full selection without mutation.
- Clip-enabled rotated Panels use an absolute, rotation-aware Fabric clipPath. Moving a child beyond a clip boundary is rejected atomically; moving a child beyond an auto-expand Panel retains `parentId` and expands the Panel.
- The browser acceptance specification now uses exact selection counts and reloads before comparing persisted geometry, `parentId`, unique `zIndex`, connector free/attached endpoints, and endpoint-follow geometry.

## Verification

```text
pnpm --filter whiteboard-core test
7 files, 62 tests passed

pnpm --filter whiteboard-core typecheck
passed

pnpm --filter web exec vitest run \
  tests/ui/board-fabric-surface.test.tsx \
  tests/ui/board-a11y-mirror.test.tsx \
  tests/whiteboard/spatial-interactions.test.tsx
3 files, 34 tests passed

pnpm --filter web typecheck
passed
```

`apps/web/e2e/board-spatial-relationships.spec.ts` was strengthened but not executed here. The root session owns real-service browser acceptance. No Docker stack was started and no human signoff/status was changed.
