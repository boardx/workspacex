# Scoped final rereview — workflow grants #6207

Result: CLEAN. Both original P2 findings are ADDRESSED. No new actionable P1/P2 finding in the fix delta or responsive contract.

Reviewed exact source range `708fccb7746e3a096ae60e1392056e3b056585c7..89a22aeb2a7faf0d2392615d94298ef86e502cc4`, supplied scoped-rereview.diff, final-fix/mobile-fix/footer-fix reports and `evidence/workflow-grants-i18n-6207/final-run/browser.txt`. A read-only diff from source tip to current HEAD for apps/web and apps/api produced no changes. Shared Dialog implementation was read solely to assess interaction of the two added classes with existing layout constraints.

## Original findings

1. **Reload restores workflow tab — ADDRESSED.** Both post-grant and post-revoke reloads explicitly select the capability tab before inspecting its card. Existing deep-link focus/workflow-view assertions remain intact. The final browser test completed both reload checks.
2. **Audit checks can match older history — ADDRESSED.** Grant selection excludes initial catalog event IDs; revoke selection excludes persisted pre-revoke event IDs. Both require category, action, from/to level and the real admin actor, validate timestamps and retain the matched event object. A real parsed GET after each reload must contain that same object. This binds acceptance to each current mutation within the private test tenant.

## Responsive delta

Only owned DialogContent and DialogFooter classes changed: `overflow-y-auto` supplies scrolling within the existing shared `max-h-[85vh]` boundary; `flex-wrap` permits long action labels to wrap the footer without clipping Cancel. Element order, callbacks, busy guards, canonical selection, API arguments and shared Dialog remain unchanged. No new source-level regression identified.

The E2E additions preserve physical mouse-wheel interaction, require the heading at the top and both Confirm and Cancel fully in the viewport (ratio 1) after scrolling, for grant and revoke at 1280 and 375 widths. They retain page horizontal-overflow checks and capture top/footer states. No timeout, force-click, retry or weaker assertion was introduced by this delta.

## Evidence boundary

The supplied final-run log identifies isolated scope `wsx-57d5c526c41d17fee319` and reports the exact registered case PASS: 1 test, 10.2 seconds test time, 4m0s command, 1s cleanup, 4m1s total. With the reviewed test's sequential assertions, this covers actual grant/revoke responses, new audit events and reload persistence, locale interaction, full mobile/desktop action visibility, and real member GET/PUT/DELETE denial. Earlier failed runs are not treated as acceptance. This reviewer did not rerun the test.

Root reports focused 25-case/type/lint/test-ID/list checks at source 89a22 and zero owned containers/listeners after cleanup; no new execution of these checks was performed here. Initial 76-case output remains bounded to the earlier source. Fifteen-image visual QA remains root-owned; this review does not claim all images were inspected. No CI, merge, deployment or workflow runtime-execution claim is made.

Only this requested report was written. No tests, typecheck, lint, build, browser, database, external actions or subagents were run. No deferred findings.
