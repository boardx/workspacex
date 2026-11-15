# V2 native local acceptance

Result: **one complete native test passed**, no skips, failures or flaky retries. The accepted run used the actual local CLI, persistent PGlite, API and production Next runtime. It did not mock the backend or model. Evidence is in [native/manifest.json](native/manifest.json).

Production source: `b7256029d1e4eaa34031a085e76ff9c53f109ab7`. Accepted test source: `f11304c715eac46588871b3b946a8f61f9e44bce`. The final difference from build source is only the E2E spec. The temporary Playwright configuration change was reverted byte-for-byte; bounded timeouts live in the excluded test spec. The original build receipt and guard were not edited, and the final real receipt check remained usable.

## Actual execution

- A new V2/CSS production build completed in **234.970 seconds**, with the persistent PG digest unchanged.
- After its owner released, the test acquired the existing output lease, verified the build, removed only generated Webpack `cache`, and verified the same receipt bytes and PG digest again. Free capacity changed from 12.085 to 14.448 GiB.
- The final independent reuse run completed with exit 0 in **110.062 seconds**. Playwright reported expected 1, skipped 0, unexpected 0, flaky 0 and no suite errors. This was a complete two-cycle run, not a combination of partial successes.
- Both starts explicitly used `--web start`, including with parent `NODE_ENV=development`. Fresh health probes reported the actual `start` mode. The first new group route took 2.560 seconds in this run; this is one observation, not a general performance guarantee.

The internal runner command was:

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  pnpm --filter web exec playwright test \
  --config playwright.aidt-local.config.ts --workers=1
```

It ran with Node 22 / pnpm 9, `PLAYWRIGHT_BROWSERS_PATH=/tmp/aidt-playwright`, persistent data directory `/workspace/scratch/aidt-local-persistent-acceptance/data` and seed `aidt-v2-native-20261115-final-2`. The real build used `AIDT_LOCAL_WEB_MODE=start`, `AIDT_LOCAL_REUSE_BUILD=0`, `AIDT_LOCAL_TRIM_BUILD_CACHE=1`. The accepted run used `AIDT_LOCAL_REUSE_BUILD=1` with the successful attempt-two `native-build.json` and the unmodified receipt. Its standard reservation actually reacquired API 24020; the test would reject another API port.

These are internal test settings, not a user-facing URL or a requirement for normal local use. Users use the existing local build/start/health/stop commands in the development guide.

## Behavior verified through real UI and persistence

| Requirement | Actual assertions |
| --- | --- |
| FR15 | A student problem, research value and explicit guess source were entered, confirmed, saved and recovered after a new login. A guess remained unverified. |
| FR16 | A **none-only** reflection saved without inventing a finding or filling a persona. The explicit “暂无” and confirmation recovered after restart. |
| FR17 | Three distinct student ideas were retained. The first had easy + fun labels; candidate two remained selected. Empty categories and unclassified candidates were allowed. Editing a classification reason revoked confirmation without changing the selection. |
| FR18 | With no confirmed question, the Design Workbench entry was disabled. Student question/prior view/basis/limits were confirmed; an edit revoked confirmation, and reconfirmation restored the entry. The actual saved fields and canonical confirmation were recovered. |
| FR19 | S6 explicitly copied S5's confirmed question and student prototype-reference text, including the real S5 V1 source receipt. S5 subsequently changed to V2; S6 retained its original question and V1 source. Server history preserved unchanged → return1, insufficient → undecided, insufficient → return2. Both return links carried project and saved reflection context. No newVersion was required or generated. |
| Report | The actual report included V2 records, “暂无”, classifications, original test question, insufficient evidence and next action. It saved as S6 V4 while preserving the stage draft, and recovered exactly after restart. |
| Human communication | A real human-only member message received the stored acknowledgement and recovered in the fresh browser session. The workflow made no AgentRun/design-chat generation request. |

The production CSS regression was also tested in the real browser: desktop step heading 20px, unclipped, height 28px; desktop assistant `position:absolute`, width/max-width 448px; mobile assistant `position:fixed`, height 812px within the 812px viewport. These checks exercised generated styles, not just class strings or jsdom.

## Failures preserved rather than relabeled

1. **Attempt one failed before UI acceptance.** Installed Next 14.2.15 and React 18.3.1 directories were empty; the worker could not load `processChild.js`. The disappearance cause was not established. The same official versions were restored, both tarball SHA-512 values matched the lockfile, and 6,363 Next plus 20 React files were compared. No dependency version, lockfile, PG data or business source changed.
2. **Attempt two built successfully but was interrupted.** The browser reached S5, where an unbounded exact `getByLabel` lookup stalled on a populated nested textarea. The owned runner received the coordinator-authorized SIGINT, followed by canonical stop verification. This attempt is not a UI pass.
3. **Attempt three passed the full workflow.** The real S5 DOM showed exact label count 0 versus textbox-role count 1. Semantic textbox/combobox locators and 30-second action / 60-second navigation limits corrected the test. Every prior functional assertion remained. Stage/route/HTTP-status logs made progress visible without logging headers or passwords.

See [attempts.json](native/attempts.json), [locator-diagnostic.json](native/locator-diagnostic.json), raw selected Playwright JSON and dependency-integrity receipts. The accepted run did not rebuild or edit the verified artifact.

## Cleanup and evidence boundary

Both real stops succeeded. All 13 owned ports could be bound simultaneously using canonical Node server semantics; after those probes closed, there were no matching LISTEN sockets. All advisory lease directories and native/output owners were absent. Persistent PG data remained. The two failed/interrupted attempts' 26 quarantined records were separately released only after matching exact tokens, creation windows, dead owner PIDs and simultaneous exclusive binds; the nonrecursive cleanup receipt is retained.

Selected text/JSON was scanned against private local credential values and post-login session-header values, with zero matches. Screenshots, the private diagnostic trace, account data, secrets and downloaded dependency tarballs were excluded. The private trace may contain test session headers and remains only in scratch storage.

This lane verifies real storage, UI decisions, navigation, styles and restart recovery for one local project owner. It does **not** verify a real model's teaching behavior, static-image generation, automatic transcription, microphone consent, real research collection, classroom voting, multi-user contention or 30-student load. The prototype reference used here is explicitly student-authored automation input, not a generated or independently verified prototype file. The earlier real ACL/CAS coverage and current unit results remain separate evidence.
