# Standard chat producer promotion (source proposal)

Base: a673c1044388c0eeb711b14bf87047a9bda8d6da. No shared checkout changes, build, container, browser, push or workflow trigger were performed while preparing this patch.

Only `chat-test-shards` enables production assets. Its original Playwright config/project/shard/max-failures/reporter arguments and worker environment are passed without additions. The manual observer explicitly supplies its existing two-case selector. The builder rejects empty arguments before claiming/building a dist.

Production mode and HTTP diagnostics are independent. Production servers register owned process groups using the existing quiet wrapper; the request preload is present only with diagnostics=1. Local dev and other lanes retain the original command and budgets.

The existing isolated build uses the same configuration, ports, agent and scope-derived dist as start. Its 600000ms build deadline is separate from Playwright startup/scenario budgets and included in the unchanged outer 50-minute step/60-minute job budget. Existing build receipts and reporter/coverage/artifact steps remain.

The independent post-step gate checks the latest scope's process groups and actual scope-derived dist absence. A local pure Node counterexample passed: an existing dist forces nonzero despite all recorded groups being absent, and removing that dist permits success. This does not prove Linux cleanup or a full shard passed.

## Required validation (not executed here)

1. Apply patch serially to the a673-based diagnostic branch; run existing workflow routing/display tests and web production-config/owned-process tests through the normal project setup. Ensure all original automatic check names and shard matrix are unchanged.
2. Normal affected typecheck/lint hooks and independent exact-SHA review.
3. Run the existing standard chat-test-shards workflow producer with the full original planned shard range (not the manual two-case diagnostic). Each remote Linux shard costs one bounded Next production compiler (prior two-case build was 173349ms, not a guarantee), plus its unchanged isolated PG/Redis/API/Next/loopbacks and browser concurrency. Preserve original shard reports/coverage and run the independent group/dist gate even on failure.
4. Report each real job/run/SHA, build duration, full shard verdict and external cleanup/dist proof. No automatic retry or expansion after failure. A two-case pass never substitutes for the full shards.

## Authorized source integration

The reviewed patch was applied serially to the existing `worker/chat-refresh-diagnostics-6249` branch, preserving parent receipt commit `d38184e77d8e3ec0e4e89718a252e4c782d67a12`. Before switching, the existing shared worktree was clean at frozen global source `39fb96205ac3cd4243661ee80da936ffdd872e32`; that global branch pointer remains unchanged. `origin/develop` was fetched for reference only, without merging unrelated changes.

`git apply --check` and `git diff --check` succeeded. Both existing receipt blobs were unchanged: diagnostic-plan.md=`aafd40c43ba632d7657bb302a39bb2bdc4b31f70`, production-result.json=`23e80a4bd22dcecfd8f0e944b1fd87543360fb10`. Source integration performed no tests, builds, containers, browser operations, push or workflow dispatch. The integrated exact commit requires fresh review and a separate validation grant.

## First granted pure batch: unexpected build and stopped execution

At source `183aad30536524472e30e678802f97091f560328`, the first routing/shard command exited 1: 23 tests passed and the JSON reporter boundary fixture failed at `ci-chat-shards.test.ts:57` with spawn status null after its unchanged 50000ms timeout. That fixture extracted the new production-builder command but only replaced the config/project, unintentionally starting a local Next build rather than its intended browserless child. No subsequent web tests, standard-proof command or push were started. This was a fixture adaptation omission, not an environment flake.

Only registered scope `d6e1a65b27cf222f9ac917470caf2c42cf700d58b6d0989e71a6b24e923ba8d8`, owner PID 62255 and build PGID 62275 were targeted for cleanup. TERM was issued to that recorded group. A later signal-zero check returned EPERM (not counted as absence); independent full process inventory found zero members of PGID 62275 and no owner PID. Its scope-derived directory had 1969 files and no BUILD_ID; inode/UID were recorded, only that directory was removed, and independent readback confirmed absence. Generated diagnostic logs were archived with matching file hashes before cleanup. Evidence: `/tmp/sourcechat-routing.log`, `/tmp/sourcechat-failure-diagnostics/`, `/tmp/sourcechat-failure-owned-cleanup.json`, `/tmp/sourcechat-unexpected-dist-inventory.json`.

The source-only correction explicitly replaces the known production-builder entry with direct Playwright for this browserless JSON-boundary fixture, asserts the replacement and fixture config, and removes both production/diagnostic flags. The 50000ms timeout and deliberate failure counterexamples remain unchanged. No validation of this correction has yet run.
