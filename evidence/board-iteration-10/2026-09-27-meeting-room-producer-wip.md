# Meeting-room producer implementation and execution boundary

The earlier checkpoint `3572f9f3f` was resumed after the R8 copy integration fix. Producer development is now complete for main-session integration; **the real 30-minute run has not been executed and the meeting-room lane is not passing**. Public matrix/runner remain unchanged.

## Implemented producer

- Three independent real logins: owner controller, meeting-display device owned by another member, and a third follower; real Fabric board includes a persisted sticky anchor.
- UI claim/follow and alternating real zoom inputs for at least 30 minutes **and** 360 observed state revisions. No short-duration override, timestamp interpolation or skipped long run.
- Every sample binds an actual authenticated API GET response, a passively observed browser presentation POST, two actual Fabric viewport projections and two canonical content hashes. Wall and monotonic clocks, sample gaps, strictly increasing revisions and changing viewports are validated.
- Mid-run browser-context offline transition; actual reconnection/reload, rotating room reconnect token (only hashes recorded), stable actor and recovered viewport/content.
- Explicit leave/refollow, concurrent presenter CAS (one accepted, one 409), handoff to the display, controller following the display, manual pan exiting follow, membership revocation with rendered content removed and actual API GET/POST rejection.
- End presentation clears presenter/followers; tenant-scoped read of the persistent room row equals the final API state; browser reload retains content and released state; test board is archived and contexts are closed.
- Distinct meeting-room HMAC ledger, raw response evidence and fresh source/build/chunk/runtime binding. Secrets and reconnect tokens are excluded; partial failure artifacts cannot be accepted as complete.

## Static and unit verification

- `pnpm --filter web exec vitest run --config vitest.board-meeting-room.config.ts` — validator counterproofs only, not a meeting run. Includes re-signed and re-chained invalid duration/clock/gaps/identity/revision/projection, missing raw writes, reused response, lifecycle ordering, token rotation, CAS/ACL/persistence and build identity cases.
- Playwright `--list` through `playwright.board-meeting-room-acceptance.config.ts` collects one real lifecycle scenario without launching servers or browsers.
- Full Web typecheck must be reported separately from baseline unrelated diagnostics; no claim of whole-repo green is made here.

## Main-session command and prerequisites

Supply `BOARD_ACCEPTANCE_LEDGER_KEY` (at least 32 characters, kept outside logs), a clean exact integrated SHA, working R9 presentation APIs/UI and R6 viewport observation attributes. Run:

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.board-meeting-room-acceptance.config.ts
```

Success produces `meeting-room-ledger.json` under the Playwright test output; failure produces `meeting-room-partial.json`. `validateRoomArtifact` is exported for later runner integration and returns failures rather than a score. Independent review remains necessary: signatures bind observations but do not independently establish producer trust.

Current product boundary to resolve before acceptance: inspected R9 code does not wire intentional manual pan to `leave-follow`; the real assertion deliberately exposes this instead of silently accepting continued following. This is desktop meeting-display browser evidence, **not physical touchscreen/stylus hardware evidence**. Real UI/DB/long-duration execution is exclusively owned by the main session.
