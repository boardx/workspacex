# Survey collection batches and prototype-aligned workspace

## Context

The current survey aggregate stores only one `publication`. Once collection is
closed, the state machine has no transition back to collection. The publish
workspace also constrains its content to `max-w-7xl`, making it visibly
narrower than the adjacent design and response workspaces. Users therefore
cannot clearly republish a stopped survey, and the collection UI does not match
the approved prototype.

## Goals

- Render published survey collection as the prototype's full-width two-column
  workspace.
- Let an owner republish a stopped survey without reopening its old link.
- Preserve the questions, settings, link, timestamps and answers of every
  previous collection batch.
- Keep the existing draft → ready → collecting validation and frozen-publication
  behavior intact.

## Non-goals

- Do not edit an existing publication's question set, anonymity setting,
  deadline or public link.
- Do not migrate historical answer values between question snapshots.
- Do not change the public respondent form except to resolve a token to its
  owning collection batch.

## Data model and invariants

`SurveyRuntime` gains a chronological `collectionBatches` collection and an
`activeCollectionBatchId` reference. A batch contains the existing publication
snapshot fields plus immutable `id`, `createdAt`, `closedAt` and a status of
`collecting` or `closed`.

The current `publication` field remains a compatibility projection of the
active batch while a batch is collecting. Existing persisted surveys with only
`publication` are hydrated as their first batch at read time and persisted in
the new representation on the next mutation.

Every response receives `collectionBatchId` when submitted. A batch may be
closed but never changed; its token is permanently rejected after closure. A
new batch always receives a fresh token and source snapshot. Aggregate-level
answer history remains available, while collection metrics and the default
workspace view are filtered to the selected batch.

## Commands and API behavior

The existing `start-collection` command remains valid only from `ready`; it
creates the first collection batch. `close` closes the active batch and sets
the survey status to `closed`.

Add `POST /surveys/:id/republish` with `expectedVersion` and optional
`expiresAt`. It is valid only when the survey is `closed`. It reruns the
existing publish validation against the frozen/current editable design,
creates a fresh collection batch and token, moves the survey to `collecting`,
and leaves all prior batches and responses unchanged. Concurrent or stale
requests receive the existing version/transition error behavior.

The runtime response returns the batch list, active batch and selected-batch
response counts. The public survey lookup and submission path resolve the
incoming publication token to exactly one batch and stamp that id into the
new response.

## Workspace UX

Published collection uses the same outer width and horizontal rhythm as the
design and response steps, with a responsive two-column grid:

- The primary column shows the current batch state card, three metrics,
  sharing card and the primary lifecycle action.
- The secondary column shows frozen recovery settings, a compact batch selector
  when history exists, and recent activity for the selected batch.
- Collecting state uses the `正在回收` badge and a destructive `停止回收` action.
- Closed state uses the `已停止回收` badge and a primary `再次发布` action. The
  secondary `复制为新草稿` action remains available for content changes.
- Selecting an earlier batch is read-only: its metrics, link and settings are
  visible, and it cannot be reopened.

Draft and ready states retain the current preparation/check flow. The page
does not pretend that a successful-stop refresh failure is a republishable
state.

## Verification

- State-machine and service tests prove closed → republish creates a fresh
  batch/token and does not mutate old snapshots or answers.
- Public submission tests prove each answer is attributed to the token's
  batch and a closed token is rejected.
- UI tests cover collecting, closed-with-republish, history selection and the
  full-width prototype hierarchy.
- Run the affected API and Web test suites, Web typecheck/lint, then required
  PR CI.

## Rollout and compatibility

No destructive migration runs at release. Compatibility hydration preserves
the legacy `publication` payload before any write. The new UI gracefully falls
back to a single legacy batch. A failed republish leaves the previous closed
batch unchanged and visible.
