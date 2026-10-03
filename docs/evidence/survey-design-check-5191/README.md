# Survey automatic design checks — #5191

The user confirmed the design on 2026-10-03: validate automatically during design and use the publishing page for collection settings. The API must still validate the saved survey atomically before collection starts.

Implementation moves the existing evaluator unchanged into the public contracts package so the browser and API use one rule set. Current design errors update on editing. Publishing removes the separate prepare action; a saved draft publishes atomically, and a ready survey starts collection. The choice uses the state returned after saving. Server-side validation failures return to design with repair actions and configuration/logic diagnostics.

## Verification

- Baseline `./init.sh --quick`: exit 0.
- New automatic-design/direct-publish tests first failed before implementation: 2 failed, 12 skipped. After implementation: 2 passed, 12 skipped.
- Independent source review identified ready + unsaved template edits returning to draft during save. The command now resolves the operation after saving; ready-template-edit and rejection-after-save regressions now pass.

- Affected browser-unit suite: 77 tests passed across `survey-live-publishing`, `survey-live-workspace`, `survey-workflow-shell` and `publish-readiness`.
- API publish gate domain suite: 8 tests passed; this is domain validation, not HTTP evidence.
- Web, API and contracts typechecks: exit 0. Affected web ESLint, API lint and contracts lint: exit 0.

The 17 publishing tests cover automatic validation updating on edits, direct draft publication, clean ready collection, dirty ready template saving to draft before publication, server rejection after saving retaining diagnostics, repair routing, retryable failures, authoritative server responses, historical batch isolation and anonymity persistence.

Exact commit review, real browser and HTTP evidence and CI results are pending. No claim of final acceptance yet.
