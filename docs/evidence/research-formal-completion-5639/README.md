# Professional report completion — #5639

The user requires automatic formal delivery with research limitations in prose. Source failures and honest evidence gaps must not require manual certification or make a quality-passed report partially complete. Unsupported assertions, omitted answers, transport failures and unsuccessful persistence still block completion.

## Actual incident

Authorized read-only browser inspection of `grs_fa383f2439334ee3901ba552401cb972` on 2026-10-12 found `report=null`, a four-chapter `reportDraft`, `completed=false`, `reportPartial=false`, and `RESEARCH_REPORT_QUALITY_INSUFFICIENT`. The visible prose was therefore a draft, not a formal publication with an old error label. Warnings concerned chapter 2 question 1 (no own question evidence), chapter 2 question 3 (available direct excerpt but a specific missing empirical preference metric), and chapter 3 question 7 (context-only evidence). Positive review rationales do not mechanically prove passing support or complete question coverage.

Current main already contains the question-paragraph generation and supported-answer / explicit-evidence-gap review protocol from #5546. An isolated local replay using this new session's actual original materials passes those gates without changing `supported`, importing another question's quote, clearing real quality warnings, or rewriting persisted production state. The exact deployed process SHA remains unverified.

## Changes

- `reportPartial` records search coverage limitations and no longer alone forces a quality-passed generated report into `reportDraft`. The report introduction receives an accurate search-limit explanation. Real quality warnings still retain the draft and block formal completion.
- Execution completion requires a saved formal report, `completed`, completed validation, no draft/quality error, and no active/paused/interrupted work. Historical failed searches, unavailable documents and excluded evidence batches remain diagnostic facts and report limitations, rather than resetting a completed publication to failed/partial.
- Tests preserve rejection of unfinished work, real quality defects and error states. First/repeated formal publication, saved readback and exact previous report retention are checked.

## Verification

Commands run in `/Users/shenyangjun/.codex/worktrees/799b/workspacex`:

```sh
pnpm --filter @repo/api exec vitest run --config vitest.research-unit.config.ts tests/research/guided-report-chapters.test.ts tests/research/guided-partial-report-recovery.test.ts tests/research/guided-report-partial-coverage.test.ts tests/research/guided-report-quality.test.ts tests/research/guided-three-step.test.ts
pnpm --filter web exec vitest run tests/ui/guided-research-execution-timeline.test.tsx tests/ui/guided-research-report-history.test.tsx tests/ui/guided-research-report-reading.test.tsx
pnpm --filter @repo/api typecheck
pnpm --filter web typecheck
pnpm --filter @repo/api lint
pnpm --filter web exec next lint --max-warnings 0 --file lib/research-execution-timeline.ts --file tests/ui/guided-research-execution-timeline.test.tsx
```

API 268 tests and web 33 tests pass; typechecks and lint pass. The new UI regression first failed with `执行失败` for an already completed formal report carrying coverage limitations. The API regression first failed because the generated report was still null under the old partial-search draft branch.

The existing local endpoint driver and strict readback assertion were reused, with an isolated copy of the new session. No new test framework, production write or online regeneration was used. Credentials were loaded only into child-process environment. Raw source text, prompts and responses remain private temporary files.

| Local endpoint run | HTTP / terminal | Formal chapters | Confirmed questions with saved substantive prose | Draft / quality warnings |
| --- | --- | --- | --- | --- |
| First formal generation | 200 / completed | 4 | 32 of 32 | false / 0 |
| Regeneration | 200 / completed | 4 | 32 of 32 | false / 0 |

First generation used 29 actual model requests. Regeneration used 27 exact-request recorded responses plus one actual request: total 30 actual requests, below the predeclared 65-call limit. These are not two wholly fresh vendor runs. Stored current report equals the full checkpoint chapters and canonical synthesis output; the prior formal report is retained exactly. JSON readback passed the production persisted-runtime schema and the production execution-timeline helper returns finished / `执行完成` with completed rows. Both formal report hashes were `bf98f4a89f6e6e63a3ed9ed815cdea2650e2bbe0e565d089f2497c22c8675ed2`.

Private local evidence: `/tmp/research-5639-local-safe-result.json`, `/tmp/research-5639-final-assert-safe.json`; raw/private artifacts are not committed. This is the actual production controller/service/provider on a loopback HTTP endpoint with isolated file/memory persistence. It does not attest PostgreSQL transactions, production auth, production deployment or two independent live-model runs. UI refresh here means serialized saved-state readback plus component rerender, not a successful production-browser regeneration. Online state remains unchanged pending deployment and separate browser verification.

CI shard 4 initially found four obsolete expectations in `guided-three-step.test.ts` that required terminal failed searches to force an otherwise quality-passed report into a draft until manual retry. Those expectations now assert automatic Chinese/English formal delivery, complete stored readback, retained failed-task facts and exact history across retry. All 42 tests in that file pass, including the unchanged invalid-evidence, paused-work and unresolved-quality negative controls. Production code is unchanged in this follow-up.
