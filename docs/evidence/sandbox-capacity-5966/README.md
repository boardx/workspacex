# Sandbox capacity #5966 — verification evidence

These are local observations for this change, not a production capacity certificate. No devapp/CN release or live user-load test has been performed.

## Observed passing checks

- `./init.sh` — dependency installation, generated-agent check and quick startup dependency validation passed (full monorepo verification is not implied).
- `pnpm --filter @repo/api run test:sandbox-capacity` — 4 tests passed: retry pipeline trusted owner hash, Native private owner header, outstanding Chat cancellation, checkpoint failure propagation. Real loopback/UDS transport is used; these are not database ownership tests.
- Isolated PostgreSQL selection of Native session ownership/input, session transport, abort transport, retry and onion boundary — 6 files, 30 tests passed. Native ownership is asserted from the triggering human message after visibility checks, including existing cross-organization denial cases.
- Isolated PostgreSQL cancellation selection — 2 files, 3 tests passed. Persistent `requestCancellation` reaches `cancelAtCheckpoint`, aborts a real queued HTTP sandbox request, and slot release does not later execute that command. Existing retry cancellation boundaries remain covered.
- Full Python suite with its dedicated isolated PostgreSQL/checkpointer URLs — 860 passed, 45 existing conditional skips. An earlier run without those explicit URLs had 4 missing-prerequisite failures; no skip/timeout behavior was changed.
- `pnpm --filter @repo/contracts test` — 128 files, 1240 tests passed after extending the generated artifact equality assertion with the new canonical error map.
- Capacity HTTP selection — 4 tests passed, including actual file generation and a real child PID that is killed before another command receives the execution slot.
- Final `pnpm --filter @repo/cloud-deploy test` — 64 files, 706 tests passed after restoring Docker and the genuine `flock` prerequisite.
- `pnpm --filter @repo/cloud-deploy exec vitest run test/compose.test.ts` — 5 tests passed. Both sandbox services receive the same optional stable env_file, runtime defaults are not copied into Compose, and installer/US templates agree mechanically.
- API/sandbox/cloud-deploy/contracts TypeScript checks, API architecture/security lint, cloud-deploy schema lint, contract package dependency check, test-config reachability and execution-plan format checks passed during implementation. Final verification status is recorded below.

## Failure history and limits

The final serial sandbox package run (`vitest run --maxWorkers=1 --minWorkers=1`) passed 25 files and 109 tests, with one pre-existing platform skip. Container network-isolation positive/counterproof cases and Chinese PDF glyph/readability cases passed.

The first sandbox full-package run executed 102 assertions successfully but failed three Docker-backed suites during parallel image builds when Docker Desktop lost its socket/BuildKit returned EOF. Network isolation and Chinese PDF container cases from that run are **not** recorded as passed. Docker was restarted and the serial rerun above passed.

The first real-DB run executed no tests: Debian returned HTTP 502 while building the AGE dependency image. A second build also stopped when Docker disappeared. The later isolated DB runs used the locally available real PG16/AGE image, without changing migrations or bypassing RLS. No DB suite was replaced with a mock.

The cloud-deploy full package run: 62 files passed; 702 tests passed and 4 failed. One Linux release-lock test requires `flock`, absent on this macOS host. Three Linux host-maintenance fixture cases could not build their image while Docker was unavailable. Their source files are unchanged by this PR; the affected Compose tests passed. The Linux host-maintenance selection subsequently passed all 4 cases after Docker recovery. The missing macOS `flock` tool was installed from its Homebrew source package and the full package rerun passed 64 files / 706 tests; no fixture was replaced by a mock.

No claim of zero-latency persisted cancellation, per-command cgroup isolation, durable queue recovery, global cross-service user limits, automatic scale-out, or support for 200 simultaneous heavy jobs is made.

## Final verification

Serial sandbox suite, contract suite, full Python with isolated PostgreSQL, targeted real PostgreSQL and private-transport suites passed. Use the current PR checks and `harness pr-queue` classification for CI state; local results do not imply a green PR or a production deployment.

Delivery PR: https://github.com/boardx/workspacex/pull/5968 . Read its live checks and harness classification for the current head; neither this file nor local tests claim it has merged or deployed.
