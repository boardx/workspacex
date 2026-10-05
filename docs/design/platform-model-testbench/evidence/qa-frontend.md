# PR #5376 Frontend QA

Tested HEAD dfe38ecd8964da724683645fce3c9044331c529d; worktree clean at start. Read-only production-source verification, no database/services/provider calls/build or commit.

## Automated tests

Command: `pnpm --filter web exec vitest run tests/ui/platform-model-testbench.test.tsx tests/lib/live-platform-model-test.test.ts tests/lib/model-test-money.test.ts tests/ui/org-core-model-panel.test.tsx tests/ui/admin-model-catalog.test.tsx`

Exit 0: 73/73 tests in 5 files, 9.54 seconds. Counts: testbench UI 23; API adapter 6; exact money 20; core model panel 15; model screen host 9. Output: /tmp/wsx-pr5376-frontend-qa-tests.txt.

Covered duplicate paid-submit guard, organization change abort/stale results, GET-only UUID recovery preserving failed IDs, cancel failure without redispatch, explicit acknowledgement for a new test while prior reservation remains held, six-decimal exact currency conversion/overflow, partial ASR usage, and core-model conflict refresh retaining draft with latest version. No blocking defect found in these checks.

## Actual component browser verification

Command: `node scripts/model-testbench/verify-ui.cjs /tmp/wsx-pr5376-frontend-qa-browser`

Exit 0. Widths 375/768/1280: preparation, held and held-history have no horizontal overflow; preparation and held have zero reported WCAG2A/2AA axe violations; zero browser page errors. Eight screenshots and results.json in /tmp/wsx-pr5376-frontend-qa-browser. Browser log: /tmp/wsx-pr5376-frontend-qa-browser.txt. Desktop preparation screenshot inspected: controls, explicit fee/consent, unsupported capability reason, recovery and result areas rendered coherently.

## Defects and evidence limits

Root separately identified CI ui-wiring manifest missing route registration; audio owner is correcting shared navigation metadata. This frontend component suite does not replace that CI gate.

Browser evidence uses the actual testbench component and explicit substituted API responses, with visible fixture disclaimer. It proves component behavior/layout/accessibility checks, not authenticated organization/platform acceptance or supplier invocation/charges. Core panel has mocked-API component tests, no current responsive browser screenshots; host tests stub core panel and prove current-org mounting only. No manual authenticated E2E or real provider tests performed.

I authored the testbench implementation earlier; this run is a QA rerun, not independent author code review. No production source or repository files modified during QA.
