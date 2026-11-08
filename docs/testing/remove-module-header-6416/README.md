# Shared module header removal (#6416)

User requested removal of the horizontal organization/role/language header across all modules. AppShell no longer mounts TopBar or reserves its height. Existing hideTopBar/hideRoleSwitcher props remain compatible. Page-specific headings and edition notices retain their purpose.

Desktop organization and account actions remain in IconRail. Mobile organization/account/feedback actions move to MobileTabs using the same shared components, switch-confirmation callbacks and locale state. The existing profile tab remains available.

Validation (2026-11-08):

- `./init.sh`: PASS (standard quick path).
- `pnpm --filter web typecheck`: PASS.
- Scoped ESLint on all changed TypeScript files: PASS.
- Shell regression suite: 47 tests PASS across organization switching, account navigation, panel collapse, breakpoints and anonymous redirect.
- Headless Chromium against local Next `/preview/tasks` at 320/375/768/1280: shared header absent, no document overflow, account language selection works; mobile organization menu and direct profile tab remain reachable. This uses an existing explicit-identity preview, not authenticated backend or production evidence.
- Updated existing authenticated locale E2E callers to use account menus; full authenticated backend suites were not run locally.

The coordinator tick could not run because COORD_GATEWAY_URL is not configured. Readiness was inspected; this is a direct user UI request outside its queue. No database, authorization, API or deployment change.

## Review follow-up: locale selector inventory

Reviewed all remaining `language-switcher` calls under e2e. Project workbench/list/general overview, profile, organization/platform admin, entity localization and denied model-test module calls now use `setShellLocale`. Remaining native select calls belong to login/auth entry, `/home` helper tabs (including cross-tab locale changes while a modal is open), public survey and public share pages, which own their LanguageSwitcher outside AppShell. Those independent selectors are retained. No business assertions were removed.
