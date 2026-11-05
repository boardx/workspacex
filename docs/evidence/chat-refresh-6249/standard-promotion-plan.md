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
