# Directory role cards — issue #5704

Final result: **partial; original-image comparison blocked**. Keep PR #5710 Draft.

## Target and scope

The selected second alternative is described in #5704: existing white shell, real avatars, three/two/one-column role cards, organization/official tabs, filters, task examples and explicit in-place activation. The original selected image is absent from this checkout and issue; requested from the user on 2026-10-15. Textual requirements were checked, but pixel/spacing/type fidelity against that image is **not accepted**.

No production data, permissions, deployment, merge, model calls or workflow execution were included. Readiness and workflow association do not prove business quality or acceptance.

## Runtime evidence, 2026-10-15

Starting remote HEAD verified with `gh pr view`: `40ba9b51f2375d00c717ba55c7f00d6488d0de6f`, OPEN/Draft. Its existing CI checks passed or were skipped; those results predate this follow-up.

Isolated worktree `/private/tmp/wsx-digital-directory-5704`; `./init.sh` exited 0 (repository default quick health path, not full-repo verification). Real Chromium -> production-built Next Web -> real API -> fresh PostgreSQL/Redis/MinIO, using the existing seeded fixture and isolation wrapper. No intercepted/fabricated successful API responses. Existing upstream loopbacks start with this config; this test sends no model requests.

Commands completed successfully:

```sh
pnpm --filter web exec vitest run tests/ui/agent-directory.test.tsx tests/ui/agent-directory-cards.test.tsx
# 2 files, 29 tests passed
pnpm --filter web typecheck
pnpm --filter web lint
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.digital-directory-cards.config.ts
# original isolated two-test run after fix: 2 passed, 2.0m; run-mv8wqnka-34bde674-19a97205ed25
# dedicated config: 1 passed, 1.9m; run-mv8wzeut-c7d68417-dd150be85f6c; cleanup 1s
# wrapper cleanup completed in 1s
```

The mutating browser test uses a dedicated config reusing the existing fullstack server/seed definition. It must not run in `seeded`, whose other tests require empty catalogs, or beside the existing role-pending journey. The fullstack-smoke workflow invokes `pnpm run verify:digital-directory-cards` as a separate isolated runtime before its existing checks; outputs use their own directory to preserve baseline artifacts. Final CI must confirm this new step actually runs. It checks actual computed column count, document overflow, search height >=36px, image naturalWidth, explicit activation and refreshed role cards, search/clear/category controls, keyboard Tab focus, exact role/prompt URL and composer value, and absence of member activation controls before/after activation. Component regressions cover stale organization/account/token scope and readiness boundaries; those are **component evidence**, not a browser org-switch acceptance claim.

## Captures and inspection

All eleven saved PNGs below were opened and visually inspected in this run. These capture the application viewport, including its internal scroll region; they are not a claim that every offscreen card was visually inspected.

| Step | Evidence | Result |
|---|---|---|
| 1 | [Official desktop](screenshots/01-official-desktop.png), [tablet](screenshots/01-official-tablet.png), [mobile](screenshots/01-official-mobile.png) | Real portraits, readable names, 3/2/1 layout; no horizontal document overflow. Activation remains explicit. |
| 2 | [Member pending](screenshots/01-member-pending-mobile.png) | Same real offers readable; no activation button. No permission change. |
| 3 | [Organization desktop](screenshots/02-organization-desktop.png), [tablet](screenshots/02-organization-tablet.png), [mobile](screenshots/02-organization-mobile.png) | Automatic refresh after real imports; portraits and fallback initial render; long seeded title truncates within the card. Description wraps, labels/actions stay within bounds. Conversation and unconfirmed workflow statuses remain separate. |
| 4 | [Filtered empty state](screenshots/03-filter-empty-mobile.png) | Visible empty explanation and clear-filter recovery. Search focus outline visible. Sales category returns the real sales role; clearing restores multiple cards. |
| 5 | [Read failure](screenshots/03-read-error-mobile.png) | Deliberately aborted directory read shows a clear error and retry; unroute + retry restores real API results. No synthetic success response. |
| 6 | [Prefilled draft](screenshots/04-prefilled-draft-mobile.png) | Correct research role and exact example text in composer; no send or model execution. Waited for loading UI to disappear before capture. |
| 7 | [Member after activation](screenshots/05-member-official-mobile.png) | Already-enabled state visible; member still has no activation control. |

## Defect fixed

At 390px, the search input used `flex-1` inside a column flex container, collapsing its height to approximately 20px. Changed to `sm:flex-1`, preserving the normal 36px input height on mobile. Added a real computed-height regression across all three viewports. The final mobile screenshot shows the repaired input and visible keyboard focus. No shared input component or permissions were changed.

## Remaining limits

- Original second image comparison awaits its accessible source; do not declare visual acceptance complete.
- Browser denied/loading and in-flight organization/account/token switching were not independently exercised in this run. Existing 29 component tests are supplementary evidence for those paths.
- Long title and normal wrapped descriptions were observed from existing seed/official data. Arbitrarily long unbroken text and all lower cards are not separately accepted.
- Keyboard search-to-category focus was tested; full screen-reader/contrast/accessibility compliance was not assessed.
- Workflow quality, CRM/ticket writes and business acceptance remain unverified.
- Coordination `tick` could not run: `COORD_GATEWAY_URL` absent. `readiness` was read, but its score is not product acceptance. User explicitly assigned this issue; reason for taking it outside the queue is recorded on #5704.

## Final HEAD CI

See PR #5710 checks for the follow-up commit and issue progress comments. Do not reuse starting-HEAD CI as final-HEAD evidence. No merge or production deployment is authorized.

Dedicated-lane note: initial visual work ran only this file in a fresh runtime. Before finalizing, the mutating test was moved out of the shared seeded project to avoid poisoning other tests’ empty-catalog and pending-role premises. The dedicated lane was rerun successfully and all eleven resulting captures were inspected. The original entry-point smoke test remains unchanged. The prior chat’s design generation prompt was recovered read-only, but its savedPath is null; no original pixels were available.

CI follow-up: spec-gate correctly rejected an uninvoked dedicated config. Added its root script and an explicit fullstack-smoke workflow step, preserving separate databases and artifact directories. No gate waiver or coverage allowlist was added.

CI environment follow-up: the first invoked directory step built successfully but could not launch a host browser because Chromium lives inside the existing sealed Playwright runtime, not the runner cache. The directory command now uses that same version-pinned runtime with a canonical command check and without import credentials; runtime contract regression added. This failure was not a browser assertion pass.

The dedicated step now runs first, so its verdict is available without waiting for unrelated smoke cases. The shared job budget is 40 minutes, accounting for the measured extra 5m17s isolated startup. Runtime contract suite: 9 passed. Existing smoke and geometry coverage/commands remain intact.
