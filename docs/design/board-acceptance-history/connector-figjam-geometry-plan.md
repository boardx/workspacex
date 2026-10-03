> Historical snapshot, 2026-10-02. Not current approval, runtime acceptance, or feature status. See README.md and issue #5001.

# Connector Geometry Plan

Status: design input awaiting UI/use-case/API signoff. No new Connector functionality is implemented by this document. Canonical schema remains the sole authority in `packages/contracts/src/whiteboard-document.ts`; proposed field names below must be reconciled there by the contract owner, not copied into independent runtime schemas.

## Existing Code And Scope

- `packages/whiteboard-core/src/spatial-geometry.ts`: world/local conversion and rotated attachment anchors with local pixel offsets.
- `packages/whiteboard-core/src/spatial-relationships.ts`: relationship validation, attached/free endpoint resolution, atomic creation/update/transform/delete planning.
- `apps/web/components/whiteboard/whiteboard-fabric-projection.ts`: resolves canonical endpoint identities into current world positions.
- `apps/web/components/whiteboard/fabric/board-fabric-surface.tsx`: current straight Line, fixed one-corner elbow and fixed-control cubic; label at bounding-box centre; fixed line width 2.
- `fabric/connector-interaction.ts`: rendered-alpha hit gate, all generic connector transform controls locked.
- `collaborative-thinking-editor.tsx`: current two-anchor clicks/native HTML drag-and-drop. Pointer creation and endpoint/path editing belong to the editor integration owner.

User-confirmed new scope includes straight/elbow/curve path handles, persisted stroke width and label position. This does not authorize implementation before the three-part signoff. Automatic obstacle avoidance, new self-connection behaviour, BPMN/UML semantics and automatic shape creation remain outside scope.

## Proposed Shared Geometry Interface

Keep one pure path resolver in whiteboard-core, with no Fabric/DOM dependency:

```ts
resolveConnectorPath({ start, end, type, route? }): ResolvedConnectorPath
sampleConnectorPath(path, arcLengthT): { point, tangent, normal }
nearestConnectorPoint(path, scenePoint): { arcLengthT, point, distance }
connectorPathHandles(path): readonly ConnectorPathHandle[]
editConnectorPathHandle(input, handleId, scenePoint): ConnectorRoute
connectorLabelPlacement(path, labelPosition): { point, tangent }
```

`ResolvedConnectorPath` is a discriminated line/polyline/cubic value with geometric bounds and a derived arc-length table. Fabric commands, handle positions, hit testing and label positioning consume this same value. Neither SVG strings nor Fabric JSON are persisted. Endpoint resolution remains based on canonical identity/anchor/offset. Stroke width expands visual bounds and hit tolerance, never attachment coordinates.

## Route Coordinates And Transform Rules

Single candidate agreed with contract owner: optional discriminated `route` is either `{ kind: 'curve', startOffset: {x,y}, endOffset: {x,y} }` or `{ kind: 'elbow', waypoints: WorldPoint[] }`. Route kind must match connector type; straight connectors cannot carry a route. Optional `labelPosition` uses arc-length `{ t, normalOffset }`; persisted `strokeWidth` is world pixels. Finite bounds and cardinality are defined only by the contract schema. Defaults and backward compatibility require explicit signoff.

Curve controls resolve as C1=S+startOffset and C2=E+endOffset. Offsets are world-axis vectors relative to their respective endpoints, not object-local vectors. Elbow waypoints are world-axis guide locations. This convention does not divide by endpoint deltaX, deltaY or length.

- Moving a fully free connector translates both free endpoints and all elbow waypoints in one command. Curve offsets stay unchanged. The complete route/label translates equally. Generic Fabric geometry changes are not the source of connector truth.
- When both attached objects move by the same translation in one group operation, command planning translates elbow waypoints once. Curve controls follow their respective endpoints automatically. If only one endpoint moves, elbow waypoints remain board-fixed; only that endpoint's curve control follows it.
- Attached object resize/rotation first resolves its current anchor/local offset. Curve world-axis offsets do not rotate or scale with the object, and elbow world waypoints do not change. Explicit route-handle edits change the route; explicit width edits change width. This policy must be shown in signoff examples.
- Node duplication/import must remap attachment identities and translate free endpoints/elbow waypoints exactly once. Curve relative offsets need no duplicate translation. Cross-board references remain rejected. Whole-connector scaling/rotation is outside scope; if later added it must explicitly transform routes rather than reuse generic Fabric geometry.
- Straight paths have no route controls; their endpoints are editable. A whole-line movement handle is available only when both ends are free.
- Curve paths have two endpoint-relative controls and resolve to a cubic. Handle drag updates the vector relative to its own current endpoint.
- Elbow waypoints are guide constraints, not raw Cartesian bend points. Route through guides using orthogonal segments and deterministic first/last orientation. Segment handles update the guide representation; duplicate/zero segments are removed deterministically. The exact orientation policy and handle count must be approved with UI examples before coding.
- Horizontal, vertical, reversed and coincident endpoints have no baseline division. Zero-length polyline segments are skipped. A curve with coincident endpoints can retain its two controls, with bounds derived from the entire cubic; no new self-connection admission is implied. Existing relationship validity remains authoritative.

Rejected alternative: baseline controls P=S+t(E-S)+normalOffset*N avoid single-axis division but still require an endpoint-separation direction; collapsing endpoints can flip N, and one-end movement rotates all controls unexpectedly. Endpoint-relative curve vectors and explicit elbow world guides make these transform rules easier to explain and test.

## Label And Hit Accuracy

Explicit labelPosition.t is normalized arc length, not cubic parameter. Polyline lengths are exact. Cubic length uses deterministic adaptive subdivision, stopping only when control-polygon length minus chord length is at most 0.05 world pixel per leaf AND the sum of those gaps is at most 0.25 world pixel. Parameter inversion uses the same table. Browser acceptance requires label centre within 1 screen pixel at zoom 0.5, 1 and 2, compared with independent high-resolution numerical integration. A subdivision cap must return a clear validation failure if the error budget cannot be met, never silently accept an inaccurate label.

Label normalOffset uses the unit normal of the sampled path tangent. At a polyline corner choose the outgoing segment consistently; at a zero-length segment skip it. Collapsed uncontrolled paths use the fallback tangent (1,0). Label dragging finds the nearest point on the same resolved path, then derives arc-length t and normal displacement. Legacy absent labelPosition retains current bounding-box-centre placement; migrating old labels to arc midpoint is a separate explicit product decision.

Hit testing uses nearest distance to the same line/polyline/cubic and includes half stroke width plus screen-space tolerance divided by viewport zoom. Endpoint/route handles have fixed screen-space hit size. Rendered stroke/tips/labels remain selectable without making the connector's empty rectangle intercept objects underneath.

## Ownership And Verification

Geometry owner: new pure `packages/whiteboard-core/src/connector-path.ts` / `connector-snap.ts` and corresponding tests; shared exports only coordinated with core owner. Contract owner owns `WhiteboardConnector` and normalization/command integration. Surface projection integration has one owner; editor owns pointer gesture lifecycle and contextual controls. No concurrent edits to the same integration file.

Tests: endpoint-relative vector round-trip horizontal/vertical/reversed/rotated; coincident endpoints and zero-length segments; translate both endpoints versus one; node resize/rotation; orthogonal elbow invariants; cubic bounds/tangent and independent length oracle; label inversion; stroke-width hit bounds; cancel zero commands; one release one transaction; exact undo/redo; duplication/import/reload. Real browser evidence must cover all three route kinds, control drags, label drag, endpoint reattachment/free release, zoomed hit testing, read-only/locked denial, second-client convergence and actual visible pixels. Unit success alone is not product acceptance.

## Existing B04 Offset Repair Evidence

This is an existing bug fix, not new Connector scope: `document.ts` direct geometry recomputation omitted fromOffset/toOffset although spatial planning and Fabric projection resolve them. New `connector-direct-geometry-offset.test.ts` first failed 3/3 move/resize/rotation cases (example expected x247/y31/width130/height128, actual x230/y20/width170/height110). Minimal repair passes both offsets to the existing anchor resolver; no schema change.

2026-10-01: focused direct-offset/local-offset/spatial tests passed 3 files / 26 tests with `--no-cache`; subsequently full whiteboard-core passed 14 files / 160 tests with `--no-cache`. These prove the core repair only, not the proposed new UX. Issue #4858 comment attempt was blocked by GitHub auto-review disclosure authorization; coordinator must publish through an authorized channel. No PR/merge/completion claim is made here.

Reference: [FigJam connector interaction documentation](https://help.figma.com/hc/en-us/articles/1500004414542-Create-diagrams-and-flows-with-connectors-in-FigJam). It informs interaction goals; it is not the authority for WorkspaceX geometry or contracts.
