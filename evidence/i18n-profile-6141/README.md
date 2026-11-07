# Profile and shared state i18n evidence

Closes #6141; parent audit #6133. Uses first-phase foundation #6139.

- Before implementation the real ProfileScreen failed the English heading/control/activity journey; five acceptance cases failed because displayed content remained Chinese.
- `pnpm --filter web exec vitest run tests/ui/profile-i18n.test.tsx tests/ui/profile-mobile-actions.test.tsx tests/lib/i18n-resources.test.ts tests/ui/state-shell-reserved-testid.test.tsx`: 24 tests passed. Covers original input/API values, persistent failures changing language without repeated activity requests, avatar validation, timestamps and shared state test IDs.
- `pnpm --filter web lint`: passed.
- `pnpm --filter web typecheck`: passed before the last shared billing-label reuse patch. The final normal pre-push check at product/evidence head1e4bfc5fd passed25/25 tasks (23 cached), including fresh web typecheck/lint, in4m44.936s; see static-checks.log. Subsequent commit only adds tracked logs/docs. CI must still pass for the final PR head.
- The existing real self-service-profile browser journey passed (1 test, 2m29s including startup/cleanup), covering actual browser/login/API/PostgreSQL, English edit/save/reload and 375/768/1280px no horizontal overflow, then Chinese password change/login checks. Wrapper exited0; docker ps for owned compose project returned no containers. Screenshots were visually inspected.

Independent read-only reviewer found no actionable issues at 0b2bef8d850d2a5ffe62a450514db3965031b541 against foundation 51567c4684ddd6454e8c6227ade7a29ec55e3580; reviewer did not rerun tests.

No feature-list status or human signoff was modified. This slice does not represent full application internationalization. API activity summaries are retained as source content.
