# R03 Independent-Process And Authority Acceptance

Scope: [acceptance issue #5092](https://github.com/boardx/workspacex/issues/5092),
following approved feature #4968 and historically merged PR #5002. This adds an acceptance lane, not a product
contract or a passing claim. Behavior is maintained in
[C05-C08](https://github.com/boardx/workspacex/issues/4968).
The original same-browser/generic-Sticky authority template is not independent
Connector-process evidence and is not deleted or relabelled as passing.

## Runtime Preconditions

Use an already-running isolated production API/Web candidate, fresh production
build, source/marker/chunk identity and clean Git source. Set `BOARD_CONNECTOR_WEB_URL`,
`WHITEBOARD_API_URL`, `BOARD_ACCEPTANCE_SHA`, `BOARD_ACCEPTANCE_RUNTIME_MARKER`,
`BOARD_ACCEPTANCE_RUNTIME_STARTED_AT` and the actual matching `WORKSPACEX_ISOLATION_ID`.
Provide the standard fresh fullstack identities through the runtime's existing seed;
never invent sessions or parallel-login a seed account in another suite.
The configuration does not start Docker, services, migration or reset.

```bash
node --test apps/web/e2e/support/connector-c05-oracle.test.mjs
node --test apps/web/e2e/support/connector-c06-oracle.test.mjs
node --test apps/web/e2e/support/connector-c07-oracle.test.mjs
node --test apps/web/e2e/support/connector-c08-oracle.test.mjs
node --test apps/web/e2e/support/connector-copy-oracle.test.mjs
pnpm --filter web exec playwright test --config e2e/board-connector-existing-runtime.config.ts --list
PLAYWRIGHT_JSON_OUTPUT_FILE=<fresh-output>/report.json pnpm --filter web exec playwright test --config e2e/board-connector-existing-runtime.config.ts --reporter=json --output=<fresh-output>/test-results
```

Listing and pure tests are preparation, not actual browser acceptance.

## Required Actual Observations

- Three separate Chromium launches must expose three distinct browser PIDs via CDP.
- Each real UI login's server response must confirm the prescribed distinct user ID
  and actual session token. Never write that token, login response or account secrets
  into the report. Viewer membership is real, not a mocked readOnly prop.
- Connector fixture seeding is labelled: two attached nodes, nondefault curve offsets,
  label position and red stroke. It is not user Connector creation proof.
- Editor changes width and label; owner drags actual curve and label handles.
  All three processes read actual synced phase/ARIA and the same authoritative head
  and the same authoritative head through their own real tokens. Only owner/editor
  export complete canonical data: viewer export is forbidden by the real import
  service access contract and is not used as a local-render readback shortcut.
- Each gesture requires nonempty submitted update/gesture IDs and one matching
  server ACK from the initiating process, unchanged epoch and exact seq+1. The
  concurrent same-width-field case requires both ACKs, seq+2 and the final width
  belonging to the actor whose server ACK has the final sequence number.
- Lower-canvas samples use an independent Bernstein cubic oracle and actual viewport
  attributes/DPR, without importing production path helpers. Clear selection naturally
  before sampling; verify sampling itself leaves canonical state unchanged.
- Actual local editor controls verify width, label and path; independent scene
  coordinates verify route/endpoint/label handles. All three actual canvases,
  including the viewer with disabled mutation controls and no editable handles, must paint centered continuous ink
  at the expected stroke width and native-Canvas golden label glyphs at the
  independent arc-length position. Cross-process raster equality alone is not proof:
  blank, stale label, all-red and wrong-width negative cases must fail.
- Both users hold opposite endpoint detach gestures concurrently with Meta; held
  canonical is unchanged. Release requires two attributable ACKs and exact seq+2,
  both independently predicted free endpoints and unchanged viewport. No silently
  lost endpoint edit passes. Preserve legal anchors, route, width, label, label position,
  semantic relation and tip/line styles.
  All processes must converge on the authoritative outcome and survive reload.
- Screenshots are saved as real paths with SHA256 for each process/phase. Save both
  success and failure evidence through the JSON reporter, not list-only body attachments.
- Verify exact fixture owner/name, archive with the current lifecycle revision,
  permanently delete through the signed DELETE contract and assert board-detail404.
  Archive alone does not imply head404. Close every launched browser even on
  failure; any cleanup error makes this run fail.

This bounded lane reports `requiredC05Complete=false` and `requiredRoundComplete=false`
until actual execution and independent visual review establish its scope. C06 full commenter/outsider
and held-gesture authority races, C07 concurrent history, C08 complete interchange,
390px and native hardware remain separate required work; C05's scoped result does
not close the round. Source-only or pure/list green cannot replace actual runtime.

## C06 Authority Implementation

The authority runner uses the actual
[operation schema](../../../packages/contracts/src/whiteboard-operation.ts),
[Connector command schema](../../../packages/contracts/src/whiteboard-document.ts)
and [lifecycle DELETE contract](../../../packages/contracts/src/whiteboard.ts).
The same complete Connector commands must first succeed for the owner before
viewer/commenter denial and a real separately seeded foreign user's hidden-resource
denial can count. Login response identities and server-returned board roles are
observed, not inferred from seed constants. Canonical and isolated app-role durable
manifest/update-log state must remain unchanged after denials.

Five separate fresh owned boards exercise a held curve-handle gesture interrupted
by lock, hide, Connector deletion, membership revocation and archive. Release waits
for actual authority UI changes, repaint settlement and fresh reload/transport
state, then reads the durable counterproof. At the end of the entire runner, every
case is checked again against its own board-ID-attributed full transport tail and
durable state, including archived or revoked cases whose normal API read is blocked.
Cleanup uses the actual owner/title and lifecycle CAS contract and attempts every
owned resource; combined errors preserve the original failure and cleanup failures.

Pure oracle green proves denial/cancellation assertions reject invalid statuses,
changed manifests/logs and late submissions/ACKs. It does not establish that the
browser, native database or permission behavior has passed. C07 has its own lane
below; the C08 lanes are implemented below but are not counted as accepted by either result.

## C07 History Implementation

The browser history lane extends the actual core behavior in
[connector-round03-reconnect.test.ts](../../../packages/whiteboard-core/tests/connector-round03-reconnect.test.ts).
The owner deletes one attached node through the real board menu, cascading the
Connector. A different authenticated editor moves the surviving endpoint through
an actual canvas drag. Undo/Redo/Undo must each have one attributable submitted
gesture and server ACK at the next sequence in the same epoch. Restoration preserves
the original logical node/edge identities and complete edge fields, while the
surviving node stays exactly at the independent pointer/zoom-derived peer location.
Both users' actual local endpoint projection and independent curve pixels must
agree with the persisted binding after restoration and reload.

A separate post-reload local delete/undo establishes a fresh owner's redo stack.
After the peer edits the restored Connector width, redo must explicitly refuse the
conflict without a write/ACK or canonical mutation. Pure negative checks reject lost
edge fields, recreated identities, stale connector geometry and overwritten peer
movement. They are assertion tests, not an actual user history acceptance run.

## C08 Interchange Implementation

The existing-runtime config discovers C05, C06, C07 and both C08 specs. Both C08
specs execute at 1440x900 and 390x844; discovery is not execution evidence.
`board-connector-interchange.spec.ts` exercises each straight/elbow/curve route
with bound and free advanced-field fixtures. Real portable export/import and
standard export/download followed by the supported legacy portable import must
preserve exact canonical objects under independently calculated request-ID remaps.
Both outer-file and inner-object bytes/digests and revision are checked. Invalid
width, route, reference and inner digest use exact current API failures and leave
the target canonical head/objects unchanged, rather than accepting any rejection.

`board-connector-copy-defaults.spec.ts` uses the actual board-local Copy/Paste UI,
not OS clipboard APIs. It proves one append and fresh bijective IDs, original objects
unchanged, complete Connector metadata retained, geometry/free endpoints/elbow
waypoints translated by the specified 24px offset, and curve offsets unchanged.
Whole-board duplication independently computes its different null-separated ID
hash and checks the actual receipt and complete target objects after refresh.
An old record omitting width/type/route/label position must visibly expose width 2,
straight mode and midpoint label handle without mutating the canonical old record.

Each owned board is CAS archived and permanently deleted with a fresh detail 404.
Screenshots and JSON are persisted by path and digest, with source/chunk identity
before and after. Pure oracle checks reject missing advanced fields, stale endpoint
references, identity collisions and damaged byte envelopes. Neither these source
lanes nor the pure tests establish real HTTP, browser, database or visual acceptance.
The normal semantic/discovery gates and actual frozen-source execution remain pending.
