# Markdown rollout review repairs

Refs #4442; review feedback on #4450 verified against the actual paths.

- RED: after 409, a second save sent [2,2] instead of original [1,1]. Planning and editing now preserve the baseline on conflict. Only explicit reload can update it; provider partial failures still refresh persisted versions.
- RED: nested expert subsection was excluded from the parent range. Shared AST blocks now end at the next equal-or-shallower heading, keeping nested content with its expert.
- RED: source reader had no initialization operation. Explicit versioned POST initializes a revision if needed and hydrates legacy content under actor visibility and tenant/session locks. GET remains read-only. Idempotence, stale versions and invisible targets are tested.
- UI boot reads an existing source, or invokes the explicit initializer if no documents exist. Partially migrated records still need a later targeted migration; no claim of full consumer cutover.

Verification at 2026-09-27:

- Contracts full: 99 files / 957 PASS.
- Isolated API interview suite: 70 files / 507 PASS. Wrapper cleaned its own compose stack.
- Initialization/controller focused: 2 files / 25 PASS.
- UI planning/editing and API wrapper: 3 files / 16 PASS.
- API and web typecheck PASS.

The rollout is not yet complete: revision branches, runner Markdown-only consumption, pause/missing-answer retry, file/voice intake, browser fidelity and controlled sharing remain explicitly pending. No main push, production mutation or auto-merge.
