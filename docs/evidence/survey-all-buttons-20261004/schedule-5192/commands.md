# #5192 integration verification commands

Tests-only migration: `git diff 75af5ed28..bf3d86df -- apps/api/tests/kernel/permission-propagation-six-paths.test.ts apps/api/tests/survey/survey-attachments.test.ts apps/api/tests/survey/survey-collection-schedule.test.ts apps/web/tests/ui/survey-live-publishing.test.tsx`, checked then applied cleanly using `git apply`. No other paths were edited by the test worker.

RED commands (both Vitest exit1, parent notified before product patch):

```sh
PATH=/Users/shenyangjun/.npm-global/bin:$PATH pnpm --filter @repo/api exec vitest run --config /private/tmp/survey-all-buttons-20261004/schedule-domain.config.mts
PATH=/Users/shenyangjun/.npm-global/bin:$PATH pnpm --filter web exec vitest run tests/ui/survey-live-publishing.test.tsx -t 'selected collection start|invalid collection windows|new immutable schedule|active batch start and expiry'
```

Pure memory config includes only the new collection-schedule test file, forks1; no global DB setup. Domain10failed/2passed12total, UI4failed/17skipped21total. Logs domain-red.log/ui-red.log. Missing behavior: startsAt command/projection/batch persistence, future start access gate, selected-start defaults, time window validation, initial/republish controls, timed active label while viewing history.

RED source HEAD caf445c3c65eab8e614ea9ecd60cfaa112879f46 (currentmain基线，包含其他已合入模块；问卷排期能力尚缺失；不是docs-onlycommit). Existing deployed baseline API4234/Web4946 and browser data retained without restart or DB writes. All DB-backed GREEN checks must use a separate owned test DB, not the current browser-fixture DB.

GREEN after parent applied only product diff:

```sh
PATH=/Users/shenyangjun/.npm-global/bin:$PATH pnpm --filter @repo/api exec vitest run --config /private/tmp/survey-all-buttons-20261004/schedule-domain-green.config.mts
PATH=/Users/shenyangjun/.npm-global/bin:$PATH pnpm --filter web exec vitest run survey
PATH=/Users/shenyangjun/.npm-global/bin:$PATH pnpm exec tsx /private/tmp/survey-all-buttons-20261004/schedule-http.ts
```

All exit0: pure50tests/5files; frontend357tests/37files; realHTTP/DB-backed48tests/4files (all attachment tests, kernel permission propagation/projection, publish-gate-server-enforced, anonymity-immutable). See domain-green.log/frontend-green.log/http-db-green.log. The HTTP runner uses new separate owned database `wsx_12206c10884603680c38_schedule_http` on ownedPG20704, explicit TEST_DATABASE_URL in memory, max/minWorkers1. It never points at browser DB `wsx_12206c10884603680c38` or shared defaultPG. Fixtures are synthetic test data; no browser/realmodel success claim.

Sequential final gate commands, each exit0:

```sh
PATH=/Users/shenyangjun/.npm-global/bin:$PATH pnpm --filter web typecheck
PATH=/Users/shenyangjun/.npm-global/bin:$PATH pnpm --filter @repo/api typecheck
PATH=/Users/shenyangjun/.npm-global/bin:$PATH pnpm --filter @repo/contracts typecheck
PATH=/Users/shenyangjun/.npm-global/bin:$PATH pnpm --filter web exec next lint --max-warnings 0 --file components/survey/live/survey-workspace.tsx --file components/survey/live/collection-schedule.tsx --file lib/survey/runtime-client.ts --file tests/ui/survey-live-publishing.test.tsx
PATH=/Users/shenyangjun/.npm-global/bin:$PATH pnpm --filter @repo/api lint
PATH=/Users/shenyangjun/.npm-global/bin:$PATH node .harness/scripts/lint-contract-source.mjs
PATH=/Users/shenyangjun/.npm-global/bin:$PATH ./init.sh --quick
```

Logs typecheck-{web,api,contracts}.log,lint-{web,api,contracts}.log,init-quick.log. Quick baseline is dependency-health only, not fullrepo validation. No timeout changes, no weakened/deleted assertions. Worker owns only the four assigned test file edits plus evidence; parent owns source/Git/PR.

Existing814dc baseline API4234/Web4946 remain running from their original source; this feature's live browser behavior is not yet proven. A new exact-final-source API/Web startup is pending parent commit instruction.
