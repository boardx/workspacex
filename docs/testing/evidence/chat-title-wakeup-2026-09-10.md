# Chat title wake-up verification — #3278

## Scope and provenance

Implementation commit: `d87a1c52752ff30790747d9be0be477a168ac4e1`. The three committed files match the reviewed and locally tested working-tree files (`git diff --exit-code d87a1c527 -- <three paths>` exited 0).

| File | Git blob |
| --- | --- |
| `apps/api/src/application/chat/message-roundtrip.ts` | `ab602094a4d89ea91ba8fcdf8c9193b5af7c2ec5` |
| `apps/api/tests/agent-run/title-lock-claim.test.ts` | `cac575ac1036b7d6e2cf65738129a639bf36fcbb` |
| `apps/api/tests/chat/title-lock-dispatch.test.ts` | `083631434fb4ca171d611fb6ba43d1cfe7f056f8` |

The browser verification ran before commit, at HEAD `4744a51126dc003ce02665bdf4ea492111609b9a` plus these changes. It is not a clean-tree run at the implementation commit.

## Observed failure and reproduced mechanism

CI run `34397873281`, job `102632040613`, failed the new-organization first-chat assertion twice. Downloaded traces show Copilot POST returned HTTP 200/SSE, websocket upgrade returned 101, and a real run snapshot reported `queued` with only an `accepted` step. These observations do not establish the final database state or the unique historical cause: the artifact lacks an independent API error log and final DB dump.

Main comparison: run `34398285131`, SHA `1d2bd3a268a5584c3dc025d10379e2c8ead13b8d`, passed the same case in 6,675 ms. That suite's other failures do not establish a stable failure of this case on main.

A deterministic PostgreSQL test reproduced a compatible scheduling failure: holding the automatic-title UPDATE lock on `chat_threads` makes `claimQueued` skip the row through `FOR UPDATE SKIP LOCKED`. After the title transaction commits, the run remains queued until another claim. The fix retains immediate dispatch and adds one bounded wake-up after naming settles. The claim lock and status predicates remain responsible for preventing duplicate execution.

## Verification results

- Before the fix, two new HTTP/DB scheduling tests failed: only the first empty claim occurred.
- Final targeted run: **3 files, 8 tests passed**, standard isolation wrapper exit 0. Coverage includes successful and failed title transactions, the first kick remaining unfinished when the second arrives, concurrent claims yielding one owner, and existing title success/failure/timeout behavior.
- `pnpm --filter @repo/api typecheck`: exit 0.
- Original browser case: **one result passed in 3,731 ms**; structured report `expected=1`, `unexpected=0`, `skipped=0`, `flaky=0`. Original 20-second response assertion unchanged. Wrapper exit 0; total 1m27s.

Commands:

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/chat/title-lock-dispatch.test.ts tests/agent-run/title-lock-claim.test.ts tests/chat/generate-thread-title.test.ts
pnpm --filter @repo/api typecheck
PLAYWRIGHT_JSON_OUTPUT_FILE=/private/tmp/studio-3278-browser-report.json pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded --grep '个人 chat 第一条消息真的收到 agent 回复' --workers=1 --reporter=list,json --output=/private/tmp/studio-3278-browser-results
```

The new tests intercept the kick only to control scheduling; acceptance, row locking and claim queries use real HTTP/PostgreSQL. They do not prove model execution. Browser verification uses the standard loopback model and real registration, email verification, login, API and database. This is local integration evidence, not devapp or paid-model acceptance.

## Local evidence and cleanup

These diagnostic files are local, not embedded in this repository:

- `/private/tmp/studio-title-dispatch-red.log`
- `/private/tmp/studio-title-dispatch-final.log`
- `/private/tmp/studio-title-typecheck.log`
- `/private/tmp/studio-3278-browser.log`
- `/private/tmp/studio-3278-browser-report.json`
- CI artifacts: `/private/tmp/studio-3275-artifacts/` and `/private/tmp/studio-main-smoke-artifacts/`

The browser wrapper released its Compose project `wsx-f78fe3b4a1d89846b727`; a subsequent `docker ps -a` query for that project returned no containers. Playwright closed its servers, and the run-owned `.next-fullstack-e2e` build directory was removed. No web source or configuration change was required.
