# Chat execution plan display — #6447

User request: retain the execution summary and inline plan; remove the separate recent-actions preview and bottom passive plan summary.

Three independent rendering paths caused the duplication. RunTracePanel now suppresses its recent-actions preview whenever it shows an inline plan. The chat host selects inline-plan presentation through the existing single-source derivePlanSurface contract. This hides only passive bottom presentation; planning/confirmation, failure recovery, paused/resuming controls, pending edits, orphan constraints and action errors retain their existing surfaces. No execution records, plan ledger or API behavior are changed.

The inline card retains per-step action disclosures and the top disclosure retains the complete execution trace. Without a plan, the existing short activity preview remains available.

Validation:
- Observed two regression failures before implementation: recent-actions list remained under the inline plan, and passive bottom summary remained visible.
- Initial focused UI: 66 passed / 4 existing skipped, three files.
- Plan surface contract: 28 passed, including inline passive suppression and seven actionable state cases.
- Focused plan/trace UI regression: 26 files, 233 passed / 5 existing skipped. Existing mocked runtime-info URL warnings appeared in the failed-tool-status suite; no test failures.
- Web lint (including design/light-scope checks), web typecheck and contracts typecheck passed.

No CN release or production content mutation is part of this change.

Independent review found an editing → executing boundary: a hidden bottom surface could continue publishing expanded=true and hide the inline card. Observed the added transition regression fail, then made actual surface visibility a prerequisite for publishing expanded=true. Focused transition regression passed (72 passed / 4 existing skips across three files); reviewer rechecked and reported no remaining P1/P2 findings.

Full contracts suite: 146 files / 1488 tests passed.
