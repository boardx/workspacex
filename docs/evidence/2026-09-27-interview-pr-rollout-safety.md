# PR #4463 / #4466 rollout safety

- CI gates-fast reproduced locally: contract-source lint rejected a type alias. Changed it to schema inference; the same lint now passes.
- Review confirmed source-only confirmations bypassed legacy run creation. Default named routes now retain the established confirmation/readiness/execution path; Markdown source components are explicitly opt-in, not enabled by route selection. This deliberately defers the incomplete runtime cutover, not a claim of finished Markdown-only execution.
- Confirmed source documents are read-only and cannot regenerate until a revision branch capability exists.
- Failed generation reload reconciles partial saved Markdown into a clean editor while retaining genuinely dirty local text and 409 conflict baselines.
- Migration skips in-flight run evidence and can archive it after every run completes.
- Focused UI: 34 tests passed. Isolated database migration: 10 tests passed, including running-to-completed evidence. Web typecheck/lint and contract-source lint passed.
- Browser regression and GitHub checks are tracked separately; pending checks are not passed checks.
