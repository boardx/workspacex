# Seven-screen visual checkpoint — issue #4457

Captured 2026-09-27 using only Codex in-app browser at 1448 × 1022.
Screenshots use production presentation components with a development-only,
contract-validated fixed fixture. They are not real model/search/persistence evidence.

Files: list.png, import.png, topic.png, plan.png, research.png, chapters.png,
report.png. The header successfully navigated topic → plan → research → chapters
→ report. Return-to-list rendered the Workspace rail. New research opened the
fullscreen intake. Typing enabled confirmation, which navigated safely within
the fixture without creating a persisted session (also covered by a unit test).

Fresh checks: 8 related Vitest suites, 73 tests passed; `tsc --noEmit` passed.
Read-only review identified three preview bugs; submission ownership, list shell,
and reference anchor were corrected.

## Explicit unfinished boundaries

This is not a pixel-identical completion certificate. Differences still include
header account/notification placement, subtle background treatment, variable-data
card heights, and unsupported file/voice adapters. Fixed list preview currently
tests the card grid and shell, not the production search/filter interactions.
Research ETA must come from a supported estimator, never a hardcoded sample.
Fixture source counts and report metrics are samples, not live research outcomes.

Batch delivery: #4454 intake, #4456 list/plan, #4458 final surfaces, followed by
this QA batch. Stacked branches do not require waiting for predecessor merges;
merge remains manual. Remote CI must be inspected separately from local checks.
