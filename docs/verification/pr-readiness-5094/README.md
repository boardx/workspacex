Baseline main: 015f93335. Closes issue #5094.

Counterexample: #5085 SHA fc93530b9cdb7c5922c27c0654e7deeec5c066ad, run 37011184952 / job 110851048705. First attempt and retry both time out at whiteboard-live.spec.ts:78. #5080 and #5077 logs show the same failure. The n shortcut only activates placement; the old tests omit the real canvas click.

Both creation steps now focus a non-input tool, press n, assert no editor exists, click the real upper canvas, and assert the editor is focused. All convergence, ACL, offline recovery, multi-user undo/redo and reload assertions are preserved. Independent static review ACCEPT.

Validation: Node 22.23.2; `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded --no-deps e2e/whiteboard-live.spec.ts`: 4 passed, exit 0, including production build/type checks and successful cleanup. See browser-result.txt. ESLint on the affected spec and git diff --check passed. An initial incorrect seeded-github-import project selected no tests; that attempt is not counted as a pass. The correct seeded project was rerun completely.

New PR CI remains required. No merge performed.
