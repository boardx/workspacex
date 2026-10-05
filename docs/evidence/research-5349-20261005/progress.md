# Research three-step workflow (#5349)

The visible flow is 确认研究内容 → 研究计划 → 生成报告. The existing five-node runtime remains the durable authority. New prepare_plan and generate_report commands execute inside one claimed operation, retain checkpoints, and require explicit retry after failure. Legacy routes and optional executionGoal remain backward compatible. No interview/survey/transcription changes.

```mermaid
flowchart LR
 A[Contract and legacy compatibility] --> B[Durable composite execution]
 B --> C[Three-step UI and authoritative timeline]
 C --> D[Unit and controlled browser verification]
 D --> E[Exact SHA review and green PR]
 classDef tested fill:#e9d5ff,stroke:#7e22ce
 classDef pending fill:#e5e7eb,stroke:#6b7280
 class A,B,C,D tested
 class E pending
```

Validation (actual exit 0): API research pure 15 files/406 tests; web scoped regression 37 files/360 tests; API typecheck/lint; web typecheck and scoped lint; init.sh quick baseline; diff-check. Regression assertions cover claim/idempotency, full-scope search failures, checkpoint retries, report quality gates, late SSE/version isolation, compound plan terminal polling, and cross-session chapter-editor state.

Browser evidence uses actual Chrome and production web/runtime code with a controlled HTTP fixture. Memory store, auth, model output, search and source reads are synthetic; this is **not** PG/real-auth/provider or report quality/performance acceptance. Verified submit→editable plan→report; desktop/390px navigation; completed report refresh does not issue another command or model call (commands 2/model 17 unchanged); legacy link read does not replay; search failure blocks completion; explicit retry completes; regeneration clears old chapter/synthesis completion; pause→refresh→explicit resume completes. The synthetic fixture is not evaluated for user-requested report language/title fidelity. No live-provider latency claim is made.

Local screenshot/log archive: /Users/shenyangjun/.codex/evidence-archives/research-5349-20261005. Existing list-crash issue #5347 remains separate; restored page is not proof of deployment/cache root cause. No merge or deployment performed.

## Integrated final validation

The final production source also passed the actual isolated authentication/API/PostgreSQL fullstack test with deterministic model/search services (1 PASS, exit0). This adds PG/Auth persistency and whole-journey evidence; real-provider quality/performance remain unverified. See [safe evidence index](./evidence-index.md) for committed screenshots, cryptographic hashes and runtime source bindings. External 82ec navigation was retained; first expansion keeps the chapter editor mounted until session reset, preserving collapsed unsaved edits without implicitly mounting a new report's editor. Search loading is rendered only for the authoritative research node. Current scoped web suite: 37 files/360 PASS; typecheck/scoped lint exit0. Exact final review and fresh CI pending; old head review does not cover the new delta.
