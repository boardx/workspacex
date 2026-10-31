# Complete acceptance parallelization — #6064

Status: implementation under review; no production speedup claimed yet.

The successful queue run 41202350309 took 69m16s. Chat took 42m52s;
full-regression-core took 48m37s and started about 20 minutes after the run.
The changes remove the API prerequisite from independent package tests, split
Web into four partitions and chat into two, and retain stable final check names.

Installed-runner discovery finds 958 Web files (240/240/240/238) and 188 chat
identities (95/93), including six existing declared fixmes. These declarations
remain distinct from passed tests. Real fixture executions prove discovery and
execution agree; actual repository CI must establish runtime and resource fit.
No test impact selection is enabled in this stage.

Each aggregate requires every producer to succeed, complete disjoint coverage,
and artifacts bound to the same source SHA, run ID and run attempt. Missing,
modified, cancelled or wrong-source evidence fails closed. Re-running failed jobs
alone can leave missing current-attempt artifacts: re-run all producers instead
of reusing previous-attempt evidence. Package tests retain uncached execution,
logs and isolation. Merge-group control-plane acceptance waits for the existing
authoritative check instead of executing the same harness suite twice.

Validation: CI policy suite plus installed Vitest/Playwright fixture execution.
Real queue timings, successful source identity and any resource changes will be
recorded after the PR runs; phase 3 selection remains gated on coverage evidence.

Compatibility: retain the independent #6061 fail-fast changes and #6063 shadow
impact planner when those branches land. No branch protection, payment config,
production deployment or historical subscription changes are part of #6064.
