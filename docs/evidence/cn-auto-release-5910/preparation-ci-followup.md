# Preparation CI follow-up

Head `455eb5f6a` exposed three test-fixture failures in PR #5914:

- [release-identity-linux](https://github.com/boardx/workspacex/actions/runs/40014709817/job/120623680564):
  one of 137 tests required the old textual adjacency of the build-only guard
  and preactivate collector. The replacement executes the actual post-seal Bash
  block for artifact-only, manual and automatic modes, asserting their distinct
  calls, plus actual conflicting-mode argument rejection. Independent review
  accepted it. All 137 tests passed in the cached isolated Linux container with
  no network; the native macOS full command is not a substitute, because Linux
  `/proc/self/fd` and `prctl` tests fail there.
- [verify-affected](https://github.com/boardx/workspacex/actions/runs/40014709869/job/120624365738):
  all three cancellation fixtures failed before READY when package tests ran
  from the package directory. Module resolution incorrectly assumed repository
  cwd. A URL relative to the test module fixes both cwd cases; the fixture now
  retains bounded stderr for startup diagnostics. All three real signal cases
  pass from both package and repository cwd, with typecheck passing.
- [verify-control-plane](https://github.com/boardx/workspacex/actions/runs/40014709869/job/120624365965):
  the credential scanner identified synthetic HTTP fixture values as literal
  assignments. The fixture now constructs the same non-secret values, preserving
  leak assertions. Ten HTTP tests and incremental secret scanning pass with no
  new baseline entry or scanner-rule change.

These fixes change only tests. Production code and release gates are unchanged.
Replacement PR CI and real production acceptance remain separate requirements.

The next head `585e2a166` passed those repaired cases, but its 460-test Python
supervisor hit an existing 100ms timing race in `test_cn_backup_stream.py`:
the observer teardown was not yet proven, so it returned
`BACKUP_OBSERVER_UNPROVEN` before reaching the expected stream timeout. A real
Linux observer delayed after sending its result reproduced this boundary.
The test now completes the real fork/Pipe handshake and observer join before
advancing only the stream module's test clock across the deadline. It requires
the exact stream timeout and proves both producer/encryptor PIDs and all three
pipe threads are gone. The same cleanup checks cover oversize failure.
Independent review accepted the fixture-only change; eight cases passed on
macOS and cached Linux, with Python 3.14 verification left to replacement CI.
Production observer, deadline and cleanup code remain unchanged.

A complete local package run passed 698/699 cases; its sole failure was an
existing Linux shell fixture requiring the unavailable native macOS `flock`
binary. This is retained as an environment limit rather than described as a
green full-package run. The Linux PR lane supplies actual `flock`.

Head 55579aa passed all release-identity and backend checks; its remaining
verify-control-plane failure exposed three independent fixture/wiring problems:
Node builtin `.test.mjs` files were also discovered by Vitest, source-transfer
artifact actions missed the audited Node24 catalogue, and the real Docker
synthetic database fixture used the production 10 GiB disk reserve on a smaller
CI workspace. The Node suites are renamed `.selftest.mjs` and remain explicitly
executed by the existing workflow test. Upload uses audited v6; download uses the
catalogue's immutable audited commit. The synthetic fixture keeps actual disk
measurement and a scoped 256 MiB reserve plus three times real database size;
production's 10 GiB guard and streaming-abort negatives are unchanged. It asserts
both each dump and ciphertext remain below 1 MiB, and cannot attest production
capacity. Independent review accepted the scoped fixture.

Local replacement checks: workflow/actions tests 18 passed, two existing Linux
skips; all 23 explicitly run Node cases passed; actual Docker provider nine tests
passed in 53.027s; Linux boundary tests eight passed. Replacement full PR CI is
still required. These checks do not prove production release readiness.
