# Survey automatic design checks — #5191

The user confirmed the design on 2026-10-03: validate automatically during design and use the publishing page for collection settings. The API must still validate the saved survey atomically before collection starts.

Implementation moves the existing evaluator unchanged into the public contracts package so the browser and API use one rule set. Current design errors update on editing. Publishing removes the separate prepare action; a saved draft publishes atomically, and a ready survey starts collection. The choice uses the state returned after saving. Server-side validation failures return to design with repair actions and configuration/logic diagnostics.

## Verification

- Baseline `./init.sh --quick`: exit 0.
- New automatic-design/direct-publish tests first failed before implementation: 2 failed, 12 skipped. After implementation: 2 passed, 12 skipped.
- Independent source review identified ready + unsaved template edits returning to draft during save. The command now resolves the operation after saving; ready-template-edit and rejection-after-save regressions now pass.

- Full survey frontend suite: 37 files, 353 tests passed.
- Affected browser-unit suite: 77 tests passed across `survey-live-publishing`, `survey-live-workspace`, `survey-workflow-shell` and `publish-readiness`.
- API pure memory suite: 4 files, 38 tests passed, including the 8 publish-gate domain tests.
- Real Nest HTTP suite: 2 files, 6 tests passed against a separate test database, including server-enforced publishing and anonymity immutability.
- Web, API and contracts typechecks: exit 0. Affected web ESLint, API lint and contracts lint: exit 0.

The 17 publishing tests cover automatic validation updating on edits, direct draft publication, clean ready collection, dirty ready template saving to draft before publication, server rejection after saving retaining diagnostics, repair routing, retryable failures, authoritative server responses, historical batch isolation and anonymity persistence.

## Real browser evidence

On an isolated build of source commit `dcd2633d649a2da909020bb2b83dec8e599089c7`, created synthetic survey `95bdef02-c649-4c21-8c32-9748b7abff9d` through the UI:

1. Empty design immediately shows “问卷至少需要一道题”, without a check action — `design-empty.png`.
2. Adding a multi-line text question immediately changes the design check to “设计检查通过”. Editing its title and entering publishing persists the design.
3. Publishing shows collection settings and “开始回收”, with no manual check — `publish-settings.png`.
4. Clicking “开始回收” reaches the actual server collection state; reload retains it — `collecting-after-reload.png`.

The 17 pre-existing survey workspaces and 8 library templates were preserved, and the pending original PDF tab was not touched. This synthetic acceptance survey remains available.

Independent source/test review accepted `dcd2633d649a2da909020bb2b83dec8e599089c7`; subsequent evidence-only commits do not alter product or test bytes. CI is pending, and no merge has been performed by this session.
