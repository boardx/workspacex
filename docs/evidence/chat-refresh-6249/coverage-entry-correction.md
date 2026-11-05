# Production chat coverage entry correction

PR #6309 exact `9932b4728049a4cbe24a81863c2ca2175174dd3c` default CI
failed in `harness-verify` run `42085272977`, job `127448565010`.
`lint-spec-gate-coverage.mjs` recognized only direct Playwright commands and
therefore lost the standard chat producer after its production builder promotion.
The failed job log is retained at `/tmp/sourcechat-6309-control-plane-job.log`.
This is an entry-adapter omission, not an environment flake or a chat spec exemption.

The correction accepts only the repository-owned builder path and verifies its
actual static argv/cwd/CLI execution edges through the owned spawn helper. It
translates the verified invocation into the existing direct Playwright parser at
`apps/web`; direct command behavior remains unchanged. Unknown wrappers, altered
argv/spawn edges, grep filters and positional spec selectors fail closed. The
standard matrix command retains every original argument; discovery covers the
complete shard union rather than substituting one symbolic shard into `--list`.

The new fixture suite reads source only, creates temporary workflow skeletons,
and compares actual standard builder reachability with the original direct
command's config/project reachability. It does not import or execute the builder,
call Playwright, create a database, start a server, or launch a browser. Negative
fixtures retain `unrun` for wrong entry paths, restricted selectors, changed cwd,
and hidden grep injection in the builder, argv helper, or child spawn.

Source-only checkpoint: these correction tests have **not yet run**. Planned
minimum pure command (requires the coordinator's next resource window):

```sh
pnpm exec vitest run --config .harness/vitest.config.ts --dir .harness .harness/scripts/chat-production-gate.test.ts
```

The existing full coverage audit must also pass in CI; the fixture is not a
replacement for that gate. Complete standard chat shards run on the normal
`merge_group` event, not the default `pull_request` event. Final acceptance still
requires the normal queue's actual production build, complete unchanged shards,
owned process cleanup, and independent dist absence evidence. No manual dispatch,
timeout increase, spec exemption, or limited two-case result substitutes for it.

The first source checkpoint's independent review rejected expression-presence
proof: echo/comment shell text and an unreachable or mutated execution spine
could be credited. The prepared correction narrows recognition to actual line
commands with only the known isolation prefix and an AST-normalized supported
builder program plus owned spawn body. Missing main invocation, dead/uncalled
scenario functions, process.argv mutation and command/cwd/env reassignment are
explicit negative fixtures. These source-only changes remain untested until the
coordinator grants a separate verification window.

A second source review identified unchecked pre-spawn statements. The prepared
contract now constrains every main try-block declaration/expression and guard,
including Date.now, both note calls and final exit-code expression; it also
constrains the Promise executor's first build declaration before the direct child
spawn. Negative fixtures cover early resolve/return and injected process.exit
paths. No runtime builder/helper changes are proposed, and these fixtures have
not run in this source preparation window.

The final export edge is constrained to a unique shorthand-property object with
exactly one module.exports reference. Spread, getter, duplicate key, later
property override and module.exports rebinding fixtures fail closed. The
prepared pure suite now contains 37 cases; none has run in this window.

The completed review list is addressed in three finite contracts: main's direct
execution spine, the async owned invocation/non-async Promise executor, and the
two actual completion callbacks. Signatures, unique top-level spawn binding and
local Promise/spawn shadowing are constrained. Completion may only resolve from
no-pid error or real child.close with the original exit-code expression; early
success, synthetic close and callback code rewriting are negative mutants. Two
concentrated test groups bring the planned test case count to 39, with actual
counts and pass/fail status pending the granted verification window.

The final completion pre-review found unconstrained intermediate executor
statements. The adapter now requires exactly the 13 baseline direct statements,
with each middle position constrained, in addition to the existing signature,
spawn and completion contracts. The completion test group includes unknown
kill/return and exit-alias insertions; no API blacklist substitutes for the
complete direct-statement shape. These prepared fixtures remain unexecuted.

Source integration: the final complete temporary patch received independent
voice pre-apply review with no known blocking finding in the three contracts.
It was applied once onto fda5 after git apply --check; actual production builder
and owned runtime helper remain unchanged. The 39 planned pure cases and real
coverage gate are still unexecuted at this source-only checkpoint.

Source-only shell-container correction: the adapter now validates the complete
run block as either one unconditional invocation or the actual five-statement
standard producer sequence. It rejects all unknown lines/control structures and
heredocs, rather than matching a line inside them. The positive fixture uses the
real complete workflow run block; if-false and heredoc negatives are added to the
existing shell group. The three reviewed execution contracts are unchanged.
The planned pure case count is now 41; no tests have run at this checkpoint.

Exact c9ec pure verification actually ran: 41 cases, 40 passed and one real
baseline positive failed (log `/tmp/sourcechat-c9ec-pure.log`). The first failure
stopped the batch before the real spec coverage gate or push; c9ec was not pushed.
Read-only TypeScript AST inspection located immutableEdges treating the existing
`!env` preflight (PrefixUnaryExpression / ExclamationToken) as a write. Only
++/-- updates and delete now enter that unary write guard; assignment checks
remain unchanged. Each fixture first establishes the unmutated command/runtime
as transparent and covered, before changing only its target workflow/source.
This makes negative cases non-vacuous if baseline recognition regresses. The
existing 41 planned cases remain; this source checkpoint has not rerun them.

Default CI for source 4da checked out the normal PR merge ref
`4c5173b3b6c6614c102f18c0ddc63ba0713bfb32` (parents d9f13deb and 4da).
Run 42101196609 / job 127504128304 passed the real coverage gate, then
`pnpm exec vitest run --dir .harness --bail=1` exited 1 at
ci-static-ownership.test.ts:23: the legacy assertion required base-compile.if
to be undefined, while the accepted manual chat-refresh isolation adds a guard.
The merge-ref and 4da source blobs were identical for both the ownership test
(170c12d2737e817b634dd954bd669b595051a321) and acceptance workflow
(95e743096b7ed59d14501ef421e56b96545c1c9b); this was not merge drift.
The test-only correction evaluates that existing guard for merge_group, normal
manual all/base, and manual chat-refresh, without copying the condition. All
build/typecheck/lint order and queue-admission assertions remain unchanged.
This source-only checkpoint has not run the affected ownership test or pushed.

Normal merge-group acceptance for source 453f produced candidate
`f6056d39b1a92999fe350012c2f88ea537ffe82e`, run 42112589550. Immutable
workflow and execution logs confirm the standard production builder, unchanged
full shard argv, two workers and original budgets. Shard 1 built successfully
(204779ms), then reported 63 passed / 1 failed / 1 interrupted / 4 skipped /
7 not run; shard 2 reported 65 passed / 1 skipped before job cancellation. Both
independent owned proofs showed observed=4, groups=[], owners=[], distAbsent=true.
The original core-path refresh test passed (9175ms), but full shards did not pass.

The first failure was the stop-generation sidebar test's global `.first()`
locator. Its trace records cancel POST 202, target run terminal cancelled, and
five thread-list responses with the target thread cancelled. DOM snapshot
after@call3178 renders the current target card thr-bd997401-7140-4471-803d-e432a8ccb810
as cancelled; the failed first-card snapshot after@call3298 instead selects
thr-fc694655-8fbd-43fa-9e53-2f59be8e54c9 as done. Evidence resides in
`/tmp/sourcechat-6309-mg-f605`, with job logs alongside that directory.

The test-only correction retains the authoritative threadId already returned by
openFreshDeepAgentThread, matches the captured run to that thread, then scopes
status and wording assertions to its exact sidebar card. No cancellation product
logic, API, timeout, worker setting, or workflow changes. This source checkpoint
has not yet run the corrected real browser scenario; the normal two-worker full
merge-group shard acceptance remains required.

Real corrected-browser verification subsequently ran on exact source
`18bbf501d2d8862c7fe4e38e5cb5e04fba2a34b5`: only the stop-generation sidebar
scenario plus the original core-path simple refresh scenario, in two files,
selected explicitly and using the production builder. The log confirms
`Running 2 tests using 2 workers` and `2 passed (1.3m)`. The single production
prebuild exited 0 in 262263ms, with the original 600000ms build budget, original
server/case/expect budgets and 50-minute outer limit. The whole wrapper exited 0
in approximately 345 seconds; no list/build repetition or timeout increase.

Independent post-exit proof exited 0 with observed=4, groups=[], owners=[],
distAbsent=true. Docker resources with this isolation project's exact label
wsx-248e34300fd2913c3b37 were independently counted: containers=0, networks=0,
volumes=0. Receipt files were copied byte-for-byte with SHA-256 readback to
`/tmp/sourcechat-18bb-artifacts/`; only the exact Next-generated tsconfig include
for this scope and its three archived untracked receipt files were removed.
The worktree then read clean at the tested 18bb source.

Execution and independent evidence: `/tmp/sourcechat-18bb-browser.log`,
`/tmp/sourcechat-18bb-browser-result.json`, `/tmp/sourcechat-18bb-owned-proof.log`,
`/tmp/sourcechat-18bb-compose-proof.json`, and the archive's receipt manifest.
This follow-up changes documentation only; the tested source remains 18bb. The
limited two-case success proves this correction and refresh path, not completion
of the full standard shards. Normal default CI and complete merge-group
production shard acceptance remain outstanding.

The next normal merge candidate 28d45e2e7784d60a11f265a6cfadc243fa1a0548
(run 42130381859 / shard-2 job 127606105931) completed all 66 business cases
with 65 passed / 1 declared skip, unexpected=0, flaky=0, errors=[]. Independent
owned cleanup/dist-absence proof also passed. The subsequent --record discovery
failed with DISCOVERY_FAILED before result.json was written. The small report
artifact 13463921926 is preserved at /tmp/sourcechat-6309-28d-shard2-report.json.

The post-runtime discovery child inherited PRODUCTION_WEB=1 from the job step,
without the isolation ID that existed only inside the finished runtime wrapper.
Its config import therefore requires a missing isolation scope. The candidate
and source discovery script blobs match (9986e6d01c8e0077964cdc14750eb34e173b7f16).
The minimal correction strips only the two runtime/diagnostic flags in --list
children; non-list runtime environment, parent input, full config/project, all
partitions, identities/hash, coverage and result validation remain unchanged.
An installed-Playwright browserless fixture first proves the inherited flags
make direct discovery fail for the explicit leak guard, then verifies corrected
full discovery and unchanged runtime flags with no isolation ID. Source-only
checkpoint: these new tests and the real prod-flag --verify have not run yet.
Full merge-group shard acceptance remains necessary; prior cases are not rerun
or relabelled as a successful full merge-group result.
