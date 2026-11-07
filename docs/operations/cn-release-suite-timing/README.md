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
Single-round acceptance `all` uses two existing runner jobs: `release` and the
fixed complement `remaining`. A stdlib-only final job joins their reports using
the existing quantifier/renderer. Ten-round and targeted selections are unchanged.
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
- Linux run 41505638586: TerminalTests 12 passed in 1.857s. Release-only
  766 cases passed in 170.482s, boundary faults 71.697s, 1532 progress records.
  Artifact 13170289002 SHA256 e259d7ac286babd6c6aaee45cf4370e00d0778326918697e5051a9d5bbf3bddd.
- Same script Git blob b0e7932201d7ef2a2cfb00f3776d215bbb17aa0a in PR all run
  41505637488: 766 cases passed in 284.637s, boundary faults 124.935s,
  whole round 600.237s, all suites and owned cleanup passed.
- Rejected experiment 41508462635 put release into the existing heavy lock:
  release 246.659s, round 832.338s (+38.7%), all 28 suites/1256 executions passed.
  This harmed wall time and is withdrawn, not integrated as an acceleration fix.
- The independent-runner replacement leaves all suite patterns and the original
  300s budget/owned cleanup unchanged. `remaining` excludes exactly release and
  cannot request ten rounds. The final stable `simulation (all)` check requires
  both producer jobs to succeed, same SHA/run/attempt/seed/round, exact suite
  partition, matching per-suite inventory/cases/statistics, globally unique
  passing case IDs and verified inner/outer/required Docker cleanup. A single
  partial report cannot certify all. Reruns must produce both parts for the
  same attempt; mixing prior-attempt artifacts is rejected.
- Combined reports reuse the existing quantifier and renderer. Diagnostic
  progress remains diagnostic. Ten-round/full safety/cloud/production gates
  remain conservative; no one-round join can claim them.
- Estimated end-to-end wall time is near the original ~14min, rather than the
  rejected ~18min, with ~41% more runner use from separate setup. These are
  estimates, not a promise of a large speedup. One real split all-run and actual
  runner/job timing remain pending.
- No local database, Docker stack, production operation or full simulation is
  required for the diagnostic unit tests.
