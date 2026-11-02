# Release suite timeout measurement (#6136)

The release suite in run 41499934012 exhausted its unchanged 300-second
budget. Its cleanup receipt proves the owned cgroup was empty and removed.
The final printed case was `TerminalTests.test_recovery_requires_independent_scope_and_no_retiming`;
that line alone does not establish that the case hung.

A successful same-day baseline (41499691242) executed 762 cases in 284.950s.
Its case reports total 282.176s; `test_cn_release_boundary_faults` accounts for
128.969s and `test_cn_release_conditional_writer_adapter` for 33.577s.
The failure therefore has little budget margin; no increased timeout or reduced
coverage is justified without measuring the failing run.

## Measurement

The existing simulation workflow accepts manual `lane=release`, `rounds=1`.
It first runs the twelve terminal delegation cases under the same installed
Python SDK, isolated environment and Ubuntu runner, bounded at 25 seconds with
a traceback at 15 seconds. It then runs the existing release-only simulation
through the original root-owned clone, cgroup and 300-second suite budget.
This is partial diagnostic evidence, never full-matrix or production acceptance.

Each child retains `<suite>.tests.progress.jsonl`: case identity, start/finish,
monotonic elapsed seconds, terminal status and duration. Every boundary is
flushed and fsynced. The fixed report exporter and artifact uploader retain it
even when the parent kills a child. It contains no exception bodies, environment,
credentials or fixture payloads. A trailing start is an in-flight case, not a
failure assertion; progress never replaces inventory, final case reports or the
owned cleanup verdict. Existing bounds on exported files and total bytes apply.

## Progress / handoff

- Read-only original failure and successful baseline inspected.
- Mac single last case passed in 0.589s; TerminalTests 12 passed in 10.199s.
  These are not Linux acceptance or evidence of runner performance.
- Added timeout-survival, monotonic/status, export and workflow-bound tests.
- Linux release-only run, actual slow-segment comparison, and any evidenced
  follow-up fix remain pending. Do not shard speculatively or raise the budget.
- No local database, Docker stack, production operation or full simulation is
  required for the diagnostic unit tests.
