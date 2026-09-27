# R9 root acceptance — 2026-09-27

Tested commit: `18dfb0e58216bb8bb4aedf2160eacd7f9c5b6f5c`.

Main session ran the isolated real-provider Playwright lane (one test passed, 33.7 seconds; build and fixture included 6.1 minutes). Input was 30 fictional notes committed in `apps/web/e2e/board-real-model-organize.spec.ts`. No customer board content was used. This uses the configured DashScope model directly; it is not evidence for deep-agent tool orchestration.

The browser test verifies zero-write preview, exact unique coverage of all 30 notes, immutable runtime pin, one-revision confirmation, independent peer receipt, and one-revision server Undo restoring original semantic content. Root inspected all three resulting groups: each matches its intended theme. The second browser shares the same account; this does not prove distinct-user authorization.

The real PostgreSQL probe used `app_rw`, demonstrated publication and registry-disable locks held until transaction commit, rejected wrong tenant/delegator and registry UPDATE, and left zero persistent writes. See the allowlisted `runtime-lock.json`.

## Visual acceptance remains open

Root inspected both screenshots. The confirmed layout extends beyond the viewport instead of being fitted, the AI control obscures content, and the preview exposes low-level command/revision details. Functional success is not a 9/10 visual score. Fix and rerun the visual journey before closing R9/R10 acceptance.

Only inspected screenshots and allowlisted results are published here. Raw process logs, browser report, credentials and authorization traces remain excluded.
