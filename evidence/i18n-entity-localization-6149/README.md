# Agent / Skill display translation acceptance — #6149

The browser receipt covers UI commit `0fc68abea58601b4c260c4d6120a5545fc9314ef`.
The subsequent parent synchronization keeps the reviewed UI behavior and incorporates
the shared Locale type and compatibility expansion for long original read text.

Command (exit 0):

```sh
CIRCLE_NODE_TOTAL=2 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.entity-localization.config.ts
```

Next production build, type validation and all 130 static pages succeeded. One
browser test passed in 9.5 seconds; total lane time was 6m9s including build/setup.
`CIRCLE_NODE_TOTAL=2` uses the installed Next 14 worker-count input to generate
pages with one worker; it does not change build mode, assertions or timeout.

The test uses actual login, Next proxy, Nest controllers and PostgreSQL. It imports
the repository's unchanged v1 `work-research@1.0.1` pack, authors an English name
and summary through the admin editor, and finds that translation in the member
catalog. It verifies language switching, absence of the member admin entry, HTTP
403 for member administration, clearing back to the original, and exact equality
of the original source and version/file snapshot (bytes, paths and digests).

- `admin-translation.png`: readonly originals alongside editable English copy.
- `member-translation.png`: member search and detail show the translated content.
- `browser.txt`: complete successful lane receipt; expected member 403 is exercised.
- `ui-tests.txt`: 43 focused tests passed before the avatar review follow-up.
- `avatar-tests.txt`: two final avatar/locale tests passed after that follow-up.
- `synced-ui-tests.txt`: all 83 focused UI/client regressions passed after parent sync
  at `cae29cfd7`, with one worker.
- [`synced-api-tests.txt`](../i18n-localization-storage-6143/synced-api-tests.txt):
  all 41 API tests passed on that integrated head, including
  11 real PostgreSQL and four real HTTP cases. The shared isolation wrapper released
  its own stack in under one second. Expected 403/404/409/422 branches are logged.

Independent review of `28d926f38..75a7cc012` found one missing avatarAlt consumer.
It was reproduced with a failing accessible-label assertion and fixed in directory,
detail and visible delegation-target avatars. Re-review of `75a7cc012..0fc68abea`
found no remaining actionable issue. Reviewer performed read-only inspection;
execution receipts above were produced by the implementer.

The original config-merging attempt selected inherited projects and was interrupted
with exit 130; it is not a passing receipt. The corrected config's `--list` collects
exactly one test. Both isolated runs released their own Compose stacks and locks;
the successful wrapper reports teardown in one second.

The first UI push was refused by the unchanged built-in-capability scanner, which
interpreted the `skill`/`agent` keys of the editable DTO-field map as capability lists.
The field constants now explicitly say `SKILL_DISPLAY_FIELDS` and
`AGENT_DISPLAY_FIELDS`, selected by the same entity-kind rule. No content catalog,
lint exception or organization configuration was introduced. That scanner now passes.
The editor also imports the shared `ENTITY_LOCALIZATION_TEXT_LIMIT` instead of
repeating its value. `budget-pg-tests.txt` records 13 passing PostgreSQL tests,
including exact-boundary acceptance and above-boundary rejection for all five
columns in both tables. The nine editor/client tests and 14 contract tests remain
green (`editor-final-tests.txt`, `contracts-final-tests.txt`). These changes preserve
the browser-tested editor behavior and authoring budget.

This slice provides display translation authoring and consumption. Built-in authored
bilingual package metadata and portable import/export remain tracked in #6156.
Untranslated surrounding static UI belongs to the parallel application-copy work.

CI integration repair: the directory now calls `useOptionalSession`, so whole-module
SessionProvider test mocks must preserve that export. ChatRead supplies both hooks
from the same stable session fixture; the other affected Chat/Copilot tests retain
the actual exports and override their existing session hook. No product fallback or
permission assertion changed. `session-mock-regressions.txt` records all 184 tests
in the 22 affected files passing with one worker. The initial ChatRead reproduction
failed 36 tests; a broader sample also failed before the mock repair.

Latest CI found eight screen dependency declarations missing the shared Locale
contract. `wiring-red.txt` reproduces exactly those eight mismatches. The repository
generator was inspected, and only those eight contract additions were retained;
other generated snapshot churn was excluded. `wiring-green.txt` confirms the same
137-route scan passes. No ratchet, exemption, controller or runtime code changed.

CI then reached the later spec-coverage gate and identified the new browser spec
as local-only (run 41542426673, job 125609658462, head `3395bf1b3`). It is now
registered in the CI-reachable `seeded-github-import` product project, after the
seeded catalog-empty assertions because the spec imports a Work package.
`spec-gate-coverage-green.txt` records the complete unchanged coverage gate passing
and identifies the spec as covered; no exemption was added.
The published-null-avatar backend review fix `bca308178` is merged here. The test
merge retains both authoring-budget cases and both review regressions;
`published-avatar-budget-tests.txt` records all 15 PostgreSQL cases passing.

The newly CI-reachable spec exposed its small-catalog assumption in the combined
product suite: artifact13189476678 at head `cb5632e52` contains107 catalog entries,
a Load-more control and no first-page S157. The actual error context is retained
in `ci-catalog-pagination-failure.txt`.
The follow-up uses a private tenant/admin/member fixture and prepares the current
official dependency set from the real offer (83 Work identities; S157 lies beyond
the first50). It asserts a multi-page starting state, searches the captured original
name before editing and while switching back to Chinese, and checks the exact title
so a stable-ID badge cannot create a false language-fallback pass. Per-attempt copy
is unique, permitting a retry after a partially completed run.
`pagination-browser.txt` records the full production build/typecheck/130-page
generation and the one-worker acceptance pass (case13.1s, total4m8s, cleanup1s).
`pagination-admin.png` and `pagination-member.png` were visually inspected: editor
uses English labels, translated names/summary are visible to both roles, and members
have no authoring control. Surrounding untranslated catalog/admin copy remains in
the parallel static-UI scope. All source/file equality and permission assertions
remain; the case timeout and retries are unchanged. An initial expanded fixture
used obsolete sales1.0.0 and correctly hit409; that failed preparation is not a
passing receipt. Reading current coordinates from the real offer corrected it.
