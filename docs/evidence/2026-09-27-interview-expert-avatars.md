# Expert SVG avatars — issue #4338

## Scope and persistence boundary

24 first-party SVG portraits plus a robot icon. Default identity is a stable hash of
expertId, not name or array order. Preferences store only allowlisted avatar keys in
versioned localStorage entries, synchronized between mounted instances and tabs.
The editor explicitly states current-browser persistence, not cross-device storage.
No remote images, uploaded SVG markup, profile API changes, or research evidence changes.

Integrated in expert directory, chosen experts, expert details, question headers and
expert runs. Editing supports preview/selection, cancel, save and reset to default.
Write failures retain the dialog and show an error rather than claiming success.

## Verification (2026-09-27)

- `./init.sh`: exit 0 (standard fast initialization).
- `pnpm --filter web typecheck`: exit 0.
- `pnpm --filter web lint`: exit 0; ESLint, scope-token and design checks passed.
- `pnpm --filter web exec vitest run tests/ui/expert-avatar.test.tsx tests/ui/interview-expert-roles.test.tsx tests/ui/interview-setup-workflow.test.tsx tests/ui/interview-detail-report.test.tsx`: 4 files, 41 tests passed.
- `pnpm --filter web exec playwright test e2e/digital-interview-research-quality.spec.ts --workers=1`: 5 Chromium tests passed in 16.5 seconds. The avatar test saves a robot avatar, reloads the actual experts route, verifies restoration, resets the avatar and verifies the default.
- Screenshots rendered by this test at 375/768/1280 widths under Playwright test-results; 375 screenshot visually inspected. Avatar editor fits without horizontal overflow.
- `git diff --check`: exit 0.

Browser verification uses intercepted interview and identity API fixtures, not a live
model/backend. Avatar persistence itself uses real browser storage. No Docker stack was
started; Playwright's temporary Next server was shut down by the runner.

## Handoff

This is a directly assigned UI change, not a feature-status transition. Coordination
gateway was skipped by explicit user direction after connection timeout. GitHub CI and
review state remain authoritative for PR readiness; no automatic main merge is requested.
