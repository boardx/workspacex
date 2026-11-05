# Shared queue Chat refresh diagnosis (#6249)

Scope: a manual observation, not a product fix or a full-regression result.

Confirmed queue failures:
- #6286 candidate af1be44d6dcd1bf4de398eafc13f090980adc0eb, run42012436028/job127195398443.
- #6286 candidate ba75827a62b66b184fba5de59c7804b4138935d5, run42013977395/job127200482941.
- Both fail agent-chat-core-paths.spec.ts:95 after reload: messages element absent for the unchanged 30s budget. Stored human/agent message assertions before reload passed. Snapshot shows session confirmation; chat layout chunk did not finish in trace. In ba758 root layout completed after12.766s, chat layout remained unfinished.
- #6274 trace differs: layout/identity completed and the shell mounted, but groups of API requests remained unfinished. A trace status/time=-1 alone cannot locate browser queuing, Next proxy delay or API/PG waits.

## Minimal observation

`WSX_CHAT_REFRESH_DIAGNOSTICS=1` wraps only the existing Next/API launch commands. It records fixed route categories, request/finish/close timestamps, status and active/socket counts; child output retains compilation durations and error/warning categories. No URI, query, headers, body, SQL, token or arbitrary exception message is retained. Per-process files and launcher files are capped at1MiB including restart/rebuilt writers. No new PG connection, polling loop or CDP observer. The default launcher and test assertions/budgets remain unchanged.

The wrapper owns one detached process group. TERM/INT/HUP/QUIT terminate it, a3s deadline kills survivors, and process exit synchronously kills the owned group. SIGKILL itself is uncatchable; the existing isolation runner remains responsible for whole-stack cleanup.

## Explicit Linux experiment (requires coordinator resource grant)

Existing GitHub workflow: harness-acceptance.yml, hosted ubuntu-latest; Node from .nvmrc, pnpm frozen lockfile, Chromium from the locked Playwright installation, PostgreSQL/Redis images from the existing isolated chat-read configuration. No production environment or secret is referenced.

```
gh workflow run harness-acceptance.yml --ref worker/chat-refresh-diagnostics-6249 -f verification_lane=chat-refresh -f run_e2e_full=false -f fresh_run=true
```

The branch input was accepted by GitHub in run42018636362 on exact4db4d4075f750e3d7f6d77b591bc43f472703413. Only the diagnostic job ran; all23 ordinary jobs skipped. GitHub retained the unexpanded name expressions for skipped jobs, whose actual check names were distinct from ordinary required check names.

The production comparison job invokes an explicit bounded prebuild before the unchanged scenarios:

```
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm exec tsx apps/web/e2e/support/chat-refresh-production-build.ts
```

All other manual jobs skip and use diagnostic-skipped display names, preventing their SKIPPED checks from overwriting ordinary PR/queue check names on the same SHA. Automatic PR/merge-group and all/base names/matrix suffixes retain their original values. This experiment is not included in the required aggregate dependency lists.

Resource scope: one isolated PG/Redis/API/Next stack, existing deterministic upstreams and two Chromium workers. Do not expand to the full shard or repeat automatically. After the run, verify isolation cleanup and absence of its owned process group/containers; only this task's resources may be removed.

## Local evidence (Darwin, not Linux)

- Existing full-regression11, doc-smoke6 and browserless chat-shards5 checks passed.
- Final branch-routing11 + manual routing/display-name7 checks passed (18 total).
- Redaction/path/file-cap unit3 passed, including rebuild and already-full file counterexamples.
- Pure Node lifecycle fixture7 passed: normal child exit, launch failure, TERM, HUP, QUIT, child exception and wrapper exception all leave the recorded owned grandchild absent. No Docker/browser/database involved.
- The above checks are local Darwin results. Linux experiment results below are separate; no queue rerun, merge or production action was performed.

## One authorized Linux experiment: reproduced, not fixed

[run42018636362/job127215435499](https://github.com/boardx/workspacex/actions/runs/42018636362/job/127215435499), exact4db4d4075f750e3d7f6d77b591bc43f472703413, ubuntu-26.04 image20261101.186.1. Dependency/browser installation passed. The one experiment failed the original core-paths.spec.ts:95 assertion at11:33:10Z; planning scenario was interrupted by max-failures=1, not a second independent failure. No rerun.

Artifact13411201360 SHA256 a008a80a1ac8115c14a9019aceaf37dee4804e3385a580d9a9da1e23037243c2. Full downloaded artifact retained at /tmp/chat-refresh-6249-linux-artifact for this session. Repository summary: linux-timeline.json. Diagnostic files are all below their byte caps.

Reload wall time11:32:37.197Z. Next received chat layout request at+637ms and root layout request at+638ms. Root finished200 after1213ms; chat had no finish/close through the failure. Browser trace has no response event for that chat request and no identity request after reload. Same chat asset had previously completed in3.056s and4.968s, encoded body14,106,260bytes; headers classify it as gzip/chunked/no-store JS. Root asset encoded body4,531,827bytes. No compilation events occurred during the failed reload window; compilation last completed23s before it. API recorded262requests, all with terminal events; the slowest was a13.563s AGUI stream for the concurrent scenario and finished by reload+10.212s. Next continued serving other requests throughout.

This locates this failure before Chat hydration in the Next dev asset pipeline. It excludes a whole-API/whole-process hang in this run; it does not establish whether the asset pipeline stalled in file serving, gzip or backpressure, or establish that the different #6274 mounted-shell case has the same cause. Do not change auth, fees, reload assertions or their timeout from this evidence.

Cleanup limitation: the isolation wrapper reported1s cleanup, but final GitHub runner cleanup explicitly reaped node9149 and Next9166. The launcher did not demonstrate its own Linux cleanup: Playwright1.62 defaults to force-killing webServer groups when gracefulShutdown is absent, bypassing exit handlers of the wrapper while its detached child group survives. The next narrow diff adds explicit SIGTERM/5000ms shutdown only for diagnostic mode; its Linux behavior still needs verification. The runner ultimately reaped those processes; this is not launcher-level all-clean proof.

Proposed next verification, pending separate exact review/resource grant: exercise the same reload scenarios against production Next assets prepared outside the scenario budget, avoiding dev no-store megachunks/HMR; keep two workers and every original assertion. A production-mode pass would validate that mode, not prove a specific gzip defect. Preserve this experiment's evidence rather than blindly repeating the same head.

## Reviewed production-comparison preparation (not yet executed on Linux)

The added builder reads Next's environment from the same chat-read config used to start the server, including the isolation-assigned API/web ports and fixture agent. It claims a new hash-of-isolation dist directory and refuses an existing one. Only the diagnostic comparison enables this mode; ordinary lanes retain their original dev command, scenario budgets and checks. This is Next build/start production mode, not a claim about the standalone release image.

Prebuild deadline is600000ms and records total build time separately. Next build runs in an owned group with fixed-category safe output. Playwright is launched directly with the locked Node CLI (no pnpm intermediary), original two scenarios/two workers/30s reload assertion. TERM requests SIGINT-based Playwright teardown with bounded escalation. Next/API launchers register only numeric PID/PGID under this isolation hash. Before deleting the claimed dist inode, the builder waits for all registered groups/owners to disappear, escalating only those groups if needed. An independent workflow step verifies absence before GitHub runner orphan cleanup; child exit alone is not proof. SIGKILL of the entire owner remains uncatchable and is an explicit outer-runner boundary.

Additional local pure checks: config4, owned runner+separately detached service cleanup3 (success/timeout/TERM), existing launcher lifecycle7 and cap/redaction3 passed (17 total); workflow routing/display18 passed. These are Darwin subprocess/config checks with no Next build, browser or PG. Remote production comparison still requires an exact reviewed SHA and a fresh resource grant; do not repeat the old4db experiment.
