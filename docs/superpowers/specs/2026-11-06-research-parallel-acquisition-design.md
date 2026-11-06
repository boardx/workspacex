# Faster research planning and parallel source acquisition

Approved by the user in this chat on 2026-11-06.

## Intent
Reduce excessive waiting during plan and report generation. Independent chapters should acquire sources concurrently, then the system integrates verified material into an ordered report.

## Approach
Replace the old cross-chapter acquisition completion barrier with one global bounded task queue. Keep primary/recovery fairness and shared read/model limits of 3/2. Supplements run concurrently across up to three chapters and sequentially within each chapter. Lock only admitted source windows, not unread result tails; retain URL normalization, shared downloads, current-material checks and serialized persistence.

For named briefs, omit the brief metadata model call: existing server behavior discards its generated topic and retains every original user field. Default/unnamed briefs still generate and validate a real subject. Directions and outline retain their dependency and quality constraints.

The report starts after acquisition settles, preserving partial-source diagnostics and all existing semantic/citation reviews. Progress counts discovered/read/screened unique URLs and active reads/screens under the current execution version. Persist phase starts immediately; coalesce rapid counter updates with ordinary checkpoints to keep polling and SSE on persisted state.

## Alternatives
Increasing concurrency alone leaves the section barrier intact and risks provider pressure. Writing before source acquisition finishes conflicts with the requested consolidated report. The approved option changes scheduling while retaining existing resource caps and report verification.

## Acceptance
Gate-controlled tests prove independent work can proceed while another chapter stalls; shared URLs preserve every approved association; cancellation has no late writes. Named plan generation uses two instead of three model calls. Compare identical controlled inputs and call/read counts against the old pipeline; disclose persistence overhead and absence of real-provider/production timing. No new provider, migration, credentials, account or production setting.
