# API test sharding within the existing CI budget (#4798)

The suite has grown from the archived 584-file observation to over 1,400 discovered
files. Two measured CI attempts exhausted the existing 20-minute job budget; setup
consumed roughly four minutes and shard-four serial execution approached sixteen.
An all-passing console summary before cancellation is not a passing GitHub job.

`.harness/api-test-shards.json` is the sole shard-count source. The `api-test-plan` job outputs matrix indices and the denominator from that policy.
It also reuses `ci-targeted-ui.mjs` to prove the exact event base/head route. Only a PR
`targeted-ui` proof permits omitting the unrelated API matrix; unknown paths, changed
runtime syntax, keys, interpolation, tests, configuration or missing history select
`full`. Dependency installation for this proof is limited to preflight candidates.
`gates-test` keeps one worker per job, a separate hosted runner/PostgreSQL instance,
the existing database suffix, fail-fast enabled, frozen dependencies, cleanup and
the 20-minute budget. All native/exclusive/runtime lanes remain required. More jobs
increase setup instances and runner minutes; shorter release waits remain a measured
CI objective, not a guaranteed duration.

The gate in `gates-fast` executes `ci-api-shards.mjs --verify`. It obtains the full
canonical file list from the installed Vitest configuration, then applies Vitest's
public installed BaseSequencer to every configured index. No handwritten test list
or copy of its hash algorithm is used. Vitest 2.1.9 `list --filesOnly --shard` itself
ignores partitioning, so using those lists as partition evidence would be false.
The gate rejects empty discovery, empty partitions, duplicate or unexpected files,
and omissions using `(projectName, file)` identities; shared modules in multiple
workspace projects remain distinct. A real two-project fixture verifies full,
disjoint coverage without executing its deliberately throwing test module. It also rejects drift from the currently proven serial/default
sequencer contract. Future custom sequencers/pools require corresponding validation.
Its JSON is discovery evidence only. On full routes every actual matrix job must
finish SUCCESS before backend-required can pass. On targeted UI routes that gate
requires a successful planner, matching source/base SHAs, a plan digest and the
explicit matrix SKIPPED result. It never treats that skip as executed test coverage.
Protected merge groups and manual runs force `full`; production source admission
continues requiring all actual API shards. Its closure checker accepts only the
reviewed PR-only planner shape or the historical discovery-only shape.
All other backend lanes must finish SUCCESS on both routes; missing or cancelled
plans and unexpected skips fail closed. Required checks and queue settings are unchanged.

Initial local coverage evidence: 1,411 files, eight disjoint partitions containing
177/177/177/177/177/177/177/172 files, union exactly the full discovery. File counts
change with development and are not a policy input. Thirty-four focused tests
cover coverage counterexamples and preserved isolation/aggregate/runtime contracts.
Actual eight-job CI success and elapsed times must be recorded after the PR run.

Wait for a workflow run to terminate before same-SHA targeted retries, and rerun
aggregate checks only after their dependencies pass. An initial Electron download
HTTP 500 was separate from a real microsecond pagination defect. Cancellation near
the 20-minute boundary is supported by measured wall time and workflow budget;
GitHub's internal reason was not independently proved. Do not waive failed/cancelled
jobs, blindly retry real assertions, or expand timeout budgets to disguise growth.

UV cache discovery was left unchanged in this change. A separate optimization must
verify pinned action input semantics and prove that frozen Python dependencies and
all cross-language tests remain covered.
