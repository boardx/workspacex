# Progress — #6322

## 2026-11-06

Implemented the fifth independently scoped CN Chat fix in PR #6331. Code head fd4ac6fccda077e9820a9da498b0f74a4267f782 preserves shell pipeline failure, reads execute exit metadata and adds advisory native execution constraints. Red counterexamples preceded the change; sandbox17, API20 and Python58 passed, with one existing owned-container E003 case explicitly skipped. API/sandbox typecheck, API lint and affected pre-push passed. Independent exact-head review found no actionable findings; reviewer independently ran shell2.

The wider user request has four separate PRs already classified READY_TO_MERGE at this checkpoint: #6324 / #6318 official packs, #6326 / #6319 durable images, #6328 / #6320 approval summary, #6329 / #6321 accessible run announcements. This issue does not incorporate their implementation or mark their issues closed.

PR #6331 CI and the standard verify:quick run were still running at this documentation checkpoint. No feature state was changed; no PR merged; no CN production release or browser acceptance was performed. Continue with the live gate commands in session-handoff.md, rather than inferring current status from this dated entry.
