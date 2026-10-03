# #5099 database/API regressions and baseline

Worktree: /Users/shenyangjun/boardx/workspacex/.worktrees/coord-user-research-5019-acceptance
Branch: codex/interview-5099-report-diagnostics
Before and after HEAD: 015f93335f0db3361ee9948d8fcbeacdeb3db2b3
Before and after tracked diff SHA256 (`git diff HEAD --binary | shasum -a 256`): bd634b7b66ac6263f020b78d39937f6972e1d341174d4d9f01e3c154a8c34b23
Tracked changes remained generate-interview-markdown.ts, digital-interview.controller.ts, kernel.module.ts. Two new untracked diagnostic source/test files stayed present. This is HEAD plus the recorded worktree changes, not a clean-HEAD-only assertion. Test runner made no source edits, branch switches, worktrees or commits.

## API command
```sh
node --import tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/itv/interview-markdown-execution.test.ts tests/itv/interview-report-diagnostics.test.ts tests/itv/interview-model-markdown.test.ts tests/itv/interview-markdown-source.test.ts --maxWorkers=1 --minWorkers=1
```
Raw log: /private/tmp/wsx-interview-5019-acceptance/5099-integration.txt
Exit0: 4 files / 36 tests passed, no skips. Execution10, HTTP markdown-source10, diagnostics12, model-markdown4. Vitest21.03s, admission0s, command22s, cleanup0s, total23s.

Real isolated PostgreSQL reader/store/repository and application/API paths ran. Model responses were controlled doubles; no claim of real external model verification. Coverage includes execution retries/partial persistence/concurrency and version boundaries; source HTTP access/CAS; report diagnostic failure classification/quality dimensions/timings; preserving storage CAS errors; diagnostic sink failure not breaking generation. This suite is not a browser or production acceptance substitute.

Isolation: run-mur1f7ek-2799064e-b485105e8d01, DB wsx_b485105e8d01315b99d5, compose wsx-b485105e8d01315b99d5, pg20358. After completion exact compose-label container and volume queries returned empty. No other resources touched.

## Baseline command
```sh
./init.sh
```
Raw log: /private/tmp/wsx-interview-5019-acceptance/5099-init.txt
Exit0. Ran script normally: pnpm install (lock current; completed2.7s), normal hook installation, generated checks, quick dependency health. Default quick baseline passed; --full was not run. No standalone dev infrastructure started.

New files SHA256 after checks:
- interview-report-diagnostics.ts: 5b965e60bfc8f894fffe756192e66a8d842b3a2ba8af2cdd157d8f6b81cd47f6
- interview-report-diagnostics.test.ts: e3454a78a5d7c7336e05681ee8a66e73c841ad9c2c3e32b5fca1e1bca9009710

All owned test processes finished and resources cleaned.
