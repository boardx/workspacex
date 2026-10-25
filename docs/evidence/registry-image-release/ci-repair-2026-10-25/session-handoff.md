# Release CI repair handoff

## Verified locally

The four originally failing suites pass on all three integrated trees (28 tests each); see the adjacent focused logs. Python contract tests and exact commands/results are summarized in progress.md. Initialization health checks passed. No full-stack local acceptance is claimed.

## Changes

Latest main's reviewed image-writer policy is integrated through the three stacked PRs. Resolve conflicts by retaining source override validation/control checkout and current planner source output, supplying the mandatory build --source argument, retaining short run-attempt tags and using the audited download-artifact SHA. No production operation is included.

## Pending verification

At this recorded checkpoint GitHub Actions are running on the repaired heads. Do not infer current status from this file: query the PRs. A broad local run against an abandoned intermediate tree was stopped and does not establish full control-plane success. Gateway heartbeat is unavailable without COORD_GATEWAY_URL.

## Next action

Run `gh pr checks 5918 --repo boardx/workspacex`, then the same for 5920 and 5922; inspect any failures with `gh run view <run-id> --log-failed`. Require current-head checks per `.harness/scripts/lib/pr-queue.ts`. Preserve the dependency order #5918 → #5920 → #5922 and original issue links. Worker does not merge PRs to main.
