# PR #5240: smoke job deadline repair

The user reported GitHub could not merge despite the repository classifier returning no required blockers. That classification did not establish GitHub readiness: the fullstack-smoke check was CANCELLED after its 20-minute deadline.

Latest failing job: https://github.com/boardx/workspacex/actions/runs/37108634611/job/111162007052 (head a7b3db51d16a9c644effa66969e971b300c79e90).
Logs record 146 passing browser cases, one skipped, and seven passing geometry tests. Main smoke execution took 18.7 minutes including application startup; dependency setup, geometry and evidence work additionally consume the job budget. Cancellation occurred at the job deadline. The earlier run 37107153040 likewise recorded 146+7 passing tests but ended CANCELLED. Passing test output does not convert a cancelled check into success.

Change: give only fullstack-smoke 35 minutes of total wall-clock time. Preserve all tests, geometry checks, artifact upload, concurrency, failure handling and other job deadlines.

Local verification: Ruby YAML parser accepted the workflow; its smoke timeout is 35; git diff --check passed. The restored managed worktree has no node_modules. This commit contains only workflow configuration and evidence documentation, qualifying for the session-closer skill's missing-dependency exception to pre-push. No runtime code bypass is involved.

Next: exact commit review and latest-head CI, including an actual SUCCESS conclusion for fullstack-smoke; re-read GitHub merge readiness. Do not merge or deploy from this session. Final CI evidence belongs on PR #5240.

The first CI attempt exposed one old runtime test asserting the exact 20-minute job value (2281 other control-plane tests passed). Update that assertion to require a finite budget between 30 and 45 minutes while retaining every command, evidence and credential-isolation assertion. Reinstall pinned dependencies and run this runtime suite plus ordinary pre-push checks for the test-source change; the pure-configuration exception above no longer applies to this follow-up.

The user's actual Chrome PR page subsequently showed three conflicts after main advanced to `1fbca3267` (#5242). Merge that main commit while retaining planning budget creation/disposal, raw exception causes, both plan-repair and diagnostics unit entries, the planning-timeout UI message and neutral workflow failure message. Pure research suite: 272/272; affected UI: 31/31; isolated real PostgreSQL/authenticated HTTP suite: 48/48, with owned stack cleanup complete. Final exact-SHA review and CI remain to verify before claiming GitHub readiness.
