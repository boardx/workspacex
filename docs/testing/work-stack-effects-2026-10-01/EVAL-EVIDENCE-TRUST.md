# Evaluation evidence trust repair — #4867

## Reproduced defect

A real runner produced passing S003 evidence. Without rerunning it, changing graderVersion, changing a case assertion to an impossible queryType, or clearing fixture documents still left G0–G5 passing. Current evidence previously compared only the Skill package digest.

The first regression run demonstrated all four failures (the three mutations plus a report without new suite identity). `eval-evidence-trust/counterproof-red.log` contains that expected red result. A fifth regression covers grader implementation bytes changing without a version bump.

A second real runner defect was reproduced: Node cached `grader.ts`. Evaluating, changing its grading implementation with the same version, then evaluating again in the same process executed the old grader while recording new input bytes. `eval-evidence-trust/cache-red.log` captures this counterproof.

## Repair

- New reports automatically include `suiteDigest`, covering suite, assertions, grader and other suite-local helper/calibration bytes, excluding fixtures and reports. Fixture identity uses the existing filename/NUL/content/NUL hash algorithm. `evalEvidenceDigests` is the shared calculator used by runner and gate IO.
- G3/G4/G5 require matching subject digest, suite digest, fixture digest and grader version. Reports lacking suiteDigest remain structurally readable for historical inspection but cannot prove current gates.
- The runner hashes inputs before loading and refuses to publish a report when input bytes changed during execution.
- A suite path already loaded in this process cannot be reused with a changed suiteDigest. It fails closed and requires a fresh CLI process rather than pretending static helper imports were refreshed. The regression also starts a fresh CLI and verifies that it actually executes the changed grader and fails its cases.
- Gate script identity advances to `lint-work-stack-gates-1.0.1` for traceability. No historical report or signed package was amended to manufacture evidence.

Captured log snapshots normalize trailing whitespace only.

## Verification

- Evaluation/gate regression: five files, 60 tests passed (`eval-evidence-trust/final-regression.log`).
- Final gate counterproofs: two files, 31 tests passed (`eval-evidence-trust/gates-final-tests.log`).
- Contract compatibility and digest validation: eight tests passed (`eval-evidence-trust/contract-tests.log`).
- Cache counterproof including fresh-process execution: one targeted test passed (`eval-evidence-trust/cache-green.log`).
- The first implementation run hit a local environment issue: @repo/contracts still resolved through whole-directory node_modules symlinks to the main checkout's older contract, which rejected suiteDigest. It was not a passing run. Worktree dependencies now link external modules shallowly and workspace packages to the current tree; shared dependencies were not edited.
- Final actual runner report: `evals/work-stack/S003/reports/S003-20261001T071444-f3e91b.json`, subject 10/10 versus baseline 2/10; G0–G5 passed (`eval-evidence-trust/gates-final.log`).
- Architecture dependency lint passed. The standalone contract-source lint could not run its nested generator command; it is not claimed passing. Full TypeScript checks, database tests and browser/live-model validation were not run in this subtask; the integrating agent owns normal pre-push checks.

## Coverage boundary

Read-only review found 27 suites with 267 cases and 248 authored output samples. All sample outputs passed their own graders; all grader versions matched suite declarations, and every grader threw on an unknown assertion. This demonstrates sample/metadata consistency only. S003 is the only registered loopback subject; the other 26 have no runnable subject evidence and must not be presented as verified model capabilities.
