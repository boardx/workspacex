# CI Fail Fast Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline in this session.

**Goal:** A failed CI module must stop later modules; a failed job must stop remaining validation jobs without weakening merge gates or losing failure evidence.
**Design:** Remove Turbo continuation flags in base/compile commands; enable test matrix fail-fast. A default-branch workflow_run supervisor polls only its triggering validation run/attempt, then requests normal cancellation when an actual job fails. It never checks out candidate code or reads candidate artifacts. Failed jobs remain recorded; unfinished jobs/run may be marked cancelled by GitHub, which is not PASS. Cleanup and artifact uploads retain their existing conditions. No production release workflows or protection rules are canceled/changed.
**Trust boundary:** actions:write only in the trusted supervisor; checkout github.workflow_sha, no dependency installation. Validate repository, workflow allowlist, event, target run/attempt/SHA and re-read immediately before cancellation. A newer attempt or already completed run is never intentionally canceled. Authentication/read failures fail the supervisor visibly. Cancellation is normal (no force-cancel), preserving runner cleanup.
**Verification:** real Turbo sibling termination regression; mocked GitHub API tests for early failure, healthy completion, newer attempt, wrong run/repository, authentication failure and cancellation race; workflow wiring and existing CI policy tests. Mock API tests do not claim live GitHub cancellation acceptance.

- [x] Add failing command/matrix and supervisor boundary tests.
- [x] Implement module, matrix and same-workflow fail-fast with bounded polling.
- [x] Verify policy regressions, types/lint, independent exact-SHA review.
- [ ] Create a separate develop PR and follow checks; keep billing #6058 separate. Initial live incident run41192730887 canceled only after confirming chat-read failure.
