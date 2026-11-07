# Materials-only mixed task coverage preserves partial-search signaling (#6361 / PR #6372)

Parent: 9817e108054c51e5e2f835bef9b94e2d6effa2d6.

Two actual GuidedRuntimeService composite executions (generate_report and retry) reproduced the current-head P2: one task succeeds from an authorized internal document, another has no evidence, but reportPartial remains false and report generation never reaches its independent gates.

The materials branch now emits the existing RESEARCH_SEARCH_PARTIAL_FAILURE after persisting terminal task states if any task failed, matching executeTaskPipeline. executeComposite retains sole ownership of canRecoverPartialReport admission. No changes to source authorization, search/read prohibition, evidence/citation/quality/publication gates or retry semantics.

RED: both new executions fail at reportPartial=true against the parent. GREEN: orchestration12 + partial-recovery13 + partial-coverage62 =87 tests pass. Scoped strict TypeScript checking of the changed service and complete orchestration test exits0. Tests retain one authorized source, zero external search/read, succeeded/failed task status and failure reason, reportPartial persisted before report work, and deliberately invalid report model output still produces an error with no completed/public report. Both first execution and retry reach real report processing rather than prematurely ending at RESEARCH_TASKS_INCOMPLETE.

These are controlled in-process application/store/model-port tests, not real provider/browser/DB acceptance or new CI/full-regression green.
