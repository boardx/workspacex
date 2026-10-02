# R03 C05 Independent-Process Acceptance

Scope: issue #4968, existing PR #5002. This adds an acceptance lane, not a product
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
  including the viewer with no editing toolbar, must paint centered continuous ink
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
- Archive the owned fixture, assert head404, close every launched browser even on
  failure; any cleanup error makes this run fail.

This bounded lane reports `requiredC05Complete=false` and `requiredRoundComplete=false`
until actual execution and independent visual review establish its scope. C06 full commenter/outsider
and held-gesture authority races, C07 concurrent history, C08 complete interchange,
390px and native hardware remain separate required work; C05's scoped result does
not close the round. Source-only or pure/list green cannot replace actual runtime.
