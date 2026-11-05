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
