> Historical snapshot, 2026-10-02. Not current approval, runtime acceptance, or feature status. See README.md and issue #5001.

# Connector Authority Matrix Execution Plan

Status: planned, not executed. This document schedules the authority lane; it does not redefine acceptance IDs, signed policy, schema, or completion status.

## Authority And Ordering

Use [the existing acceptance standard](connector-figjam-acceptance.md), specifically C12 and C18-C20. C13 remains zoom/narrow coverage, not permission coverage. Run this lane after the current three-path-type and position screenshot lane releases the browser/runtime. Do not run concurrent heavy browser, API full-suite, or typecheck jobs.

The available focused tests establish local live-Yjs/CAS guards, not real multi-user authorization or browser convergence. Prior successful reports remain subsets. Preserve failed reports rather than rewriting their results after fixes.

## Preconditions

- Launch two independent browser processes, not merely two contexts. Record engines, versions and process ownership. Two Chromium processes prove process isolation, not cross-engine compatibility.
- Use real authorized owner/editor sessions A and B. Independently read each actor identity, organization, board role, epoch and current head. Never modify a storage-state role or reuse an owner session as a viewer.
- For C12, require an independently authorized same-org viewer session. If unavailable, report this lane unexecuted with the missing prerequisite; do not manufacture credentials or claim permission coverage from a mocked role.
- Create one owned disposable board and node fixtures through validated APIs. Create connectors under test with real pointer input. Save the exact canonical before snapshot, operation identifiers and source hashes without recording credentials.
- Use isolated straight, elbow and curve fixtures. Record attached old targets and the proposed new target. Do not count a seeded edge as user connector creation.

## Held Gesture Protocol

1. A starts a real endpoint, path-handle or label gesture and moves enough to show a visible preview. Before release, read the actual API head and canonical objects: the held gesture must have made zero writes. Capture held PNG, selection controls and preview endpoint/path coordinates.
2. B performs one real UI action from the scenario table. Await its server acknowledgement and read its saved canonical state. Capture the actual operation receipt. For revocation/archive, use the authorized existing management workflow, not a local React prop change.
3. Wait until A's real provider observes B's saved change; absence of propagation is a failure/timeout, not permission to release against stale state. Capture A's latest visible projection independently of the API oracle.
4. A continues movement and releases the original pointer. Attribute network/operation events to A's gesture. Rejected/cancelled gestures must not create a successful operation or overwrite B's saved fields. Unrelated comments/presence requests are not object-write evidence.
5. Re-read actual head and canonical values, then reload both processes. Verify convergence and the removal/restoration of preview/capture. A fresh legal gesture must work afterward, proving cancellation did not leave the tool stuck.

| Scenario | B action while A holds | Required distinction |
| --- | --- | --- |
| Existing edge conflict | Edit the same edge label, width, route or label position | A must not merge an old full relationship over B's saved update; latest real Fabric path must replace preview even when numeric render revisions collide. |
| Endpoint authority | Lock the edge, old attached target or intended new target separately | Reject the stale gesture without a canonical write. Unlock only through the actual authorized workflow before the next scenario. |
| Target deletion | Delete an attached target | Apply the existing signed delete/keep-free policy. Do not expect a dangling ID or manually resurrect the edge. Verify atomic undo/redo through real history and API readback. |
| Access loss | Revoke A's edit role or archive the board | Verify authoritative denial, read-only UI, preview clearing and unchanged head after A's release. Do not accept a local-only successful toast as authority. |
| Geometry-only update | Move/resize/rotate a target without changing edge relationship or access | This is a separate positive rebase case, not an automatic conflict. Validate the actual latest endpoint/path and preserve B's target geometry. |

## Viewer Lane

With the genuine viewer actor, attempt visible creation, endpoint/path/label controls and keyboard mutations. Capture that no successful mutation originates from the UI. Submit an equivalent valid request to the actual mutation endpoint and assert its exact denial status; a malformed-request 400 does not prove access control. Compare saved head/snapshot before and after, and independently re-read as owner. Keep cross-tenant isolation separately named.

## Fail-Closed Evidence

Record distinct executed/pass/fail counts, actual canonical API values, attributable receipts, screenshots with hashes, source hashes before/after, browser errors, HTTP failures and owned-resource cleanup. Expected authorization denials must be matched by exact actor/endpoint/status/action, not globally ignored. Unexpected errors or timeouts fail the lane.

Archive then delete only the owned disposable board, confirm owner identity and fresh GET 404, and close only this lane's browser processes. Never delete shared boards or stop another agent's runtime. Missing viewer credentials, a second engine, revocation workflow or full scenario coverage remains an explicit gap. Do not mark C12/C18-C20 or the complete suite passing from this plan.

## Current Source Review Boundary

The connector appearance identity is local Fabric data only; it must never become a canonical field, Yjs revision, receipt digest or CAS baseline. The current live-Yjs release guard and optional canonical connector baseline remain the authority checks. The render identity fix does not waive permissions. This source review is not a substitute for the execution above.
