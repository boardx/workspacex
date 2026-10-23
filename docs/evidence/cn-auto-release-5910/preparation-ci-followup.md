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
