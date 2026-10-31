# Complete acceptance parallelization — #6064

Status: implementation under review; no production speedup claimed yet.

The successful queue run 41202350309 took 69m16s. Chat took 42m52s;
full-regression-core took 48m37s and started about 20 minutes after the run.
The changes remove the API prerequisite from independent package tests, split
Web into four partitions and chat into two, and retain stable final check names.

Installed-runner discovery finds 958 Web files (240/240/240/238) and 132 chat-read
identities (66/66), including five existing declared fixmes. These declarations
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

Runtime validation found and corrected two compatibility issues: Vitest uses
`skipped` for four existing skipped assertions in Web shard 1 (240 files, 2,344
passed assertions, 4m3s local execution), and chat discovery must preserve the
original `--project=chat-read` boundary rather than including optional projects.
The latter is protected by an installed-runner discovery test. The workflow
keeps its actual Playwright invocation explicit so static spec coverage can
verify the project boundary without exemptions.

All four real local Web partitions completed successfully: 240/240/240/238
files, 2,344/1,991/1,959/2,082 passed assertions, 8,376 total and five existing
skipped assertions. The latter two local wall times were anomalous and are not
used as a speedup comparison. The first full local harness run found two legacy
topology assertions plus a real-discovery timeout; the topology assertions were
updated to inspect the actual producers and artifact cleanup boundaries, and
the complete focused suite is re-executed after those changes.

Coverage correction: the existing verify-control-plane job owns the complete
harness self-test suite but not all verify:harness:raw static gates. Queue
base-control-plane therefore executes every canonical static gate from the
package script before waiting for its authoritative self-test verdict. The
static helper rejects unknown script grammar or a changed terminal test
command, so future canonical additions cannot silently disappear. Only the
heavy self-test execution is reused; static coverage is not discarded.
