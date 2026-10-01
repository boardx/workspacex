# PR #4931 report disclosure regression

Code revision: `9c9d971002ad6ac6c9bee0ad903005cf97e67f69` (follow-up to `54a2841aff8f7d7f85414c0ef08e04850cf25a2a`).

Keep the simulated and unapproved document boundary visible above the saved report and inside the printable article. Optional statistics and quality checks remain collapsed. The existing browser regression explicitly opens that summary, keeps saved-Markdown and task-count assertions, and verifies the shared user-research step title at 24px. All six-stage navigation, shell, responsive and document assertions remain.

Original red evidence: [CI fullstack-smoke](https://github.com/boardx/workspacex/actions/runs/36881221532/job/110433164434): the material-statistics locator was hidden; analysis heading expected >=30px but rendered 24px.

Verification:

- `./init.sh`: passed.
- `pnpm --filter web typecheck`: exit 0.
- `pnpm --filter web exec vitest run tests/ui/interview-source-report.test.tsx tests/ui/interview-research-quality.test.tsx tests/ui/interview-workbench-header.test.tsx`: 20/20 passed on the code revision.
- Original `digital-interview-research-quality.spec.ts`, selected report-summary and six-stage prototype-journey tests: Chromium 2/2 passed, Next production build with application CSS, no retries, original assertions and default 5s expectations.
- This is the original API-route fixture browser lane. It verifies this UI change; it does not replace backend persistence evidence or complete CI gates.

The temporary local Playwright configuration used one worker, `next build && next start`, an exclusive local port, no server reuse and the repository's hermetic font fixture. No Docker stack or external model was started. Earlier dev-mode attempts failed before target assertions while client chunks/routes were still loading; their logs and traces are retained in the review evidence projection. Production rendering resolved those environment failures without weakening assertions.

Logs in this directory: `unit.log`, `typecheck.log`, `browser.log`.
