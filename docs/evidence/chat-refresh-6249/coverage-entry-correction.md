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
