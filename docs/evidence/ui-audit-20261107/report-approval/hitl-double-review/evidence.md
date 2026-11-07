# Existing HITL approval must not interrupt twice (#6362 / PR #6374)

Parent: 53f345dca4ac5f2afe780712e27a8ed555a02ec6 (merged v5 base retained).

The real installed LangChain graph reproduced four failures for sync/async approve/edit with an existing HITL policy; eight wrapper/reject controls passed. Existing tests used interrupt_on={} and missed this composition.

The graph now installs one official HITL subclass with the complete original policy, including allowed_decisions and when. A task-scoped ContextVar collects only actual upstream approve/edit decisions and checkpoints exact id/name/canonical-args identities in a private input/output-excluded state field. Every model turn replaces the list. The dispatch wrapper recognizes that identity, still checks the host, and fails closed if that exact host-bound call remains denied. Other calls retain wrapper approve/edit/reject interrupt replay. This is an adapter around upstream private _process_decision, not a public API; real graph contract tests pin its behavior to the lockfile dependencies.

Validation in an archive of the exact parent plus this patch, using the existing Python3.13 environment:

- RED: 4 failed / 8 passed for extended original approval test.
- GREEN: native_report_approval 30 passed. Includes sync/async approve/edit/reject, strict host denial with no second interrupt, actual marker input injection, next-turn same-id/same-args when=False reset, concurrent thread isolation, respond/reject zero dispatch, full allowed_decisions and exactly one actual graph HITL node, and real Runtime fixture export.
- native_tool_authority: 26 passed (strict HTTP response, identity, deadlines/caps and denial).
- native_interaction_tools + report_file_completion: 21 passed.

Evidence logs accompany this note. Initial broad invocation used a nonexistent test filename (no tests ran); the next broad run began before the direct-call test compatibility fix and failed. Neither is counted green. An initial Runtime fixture failure was a missing sibling API golden fixture in the temporary archive; copying the exact parent fixture restored the unchanged assertion.

This does not assert real sandbox/model execution, new CI success, full regression success, or resolve the independent CI TC5 durable-checkpoint failure. That log is retained separately.
