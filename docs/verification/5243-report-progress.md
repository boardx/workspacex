# Report progress and recovery — #5243

Original real session: report preparation included failed document rereads; evidence had 18 batches and 19 total calls (not nineteen retries). It ended with RESEARCH_WORKFLOW_UNAVAILABLE and two durable chapters. No sources or chapters were deleted.

Changes: publish the confirmed destination before external work; reuse document outcomes without automatic transient rereads during report generation; four bounded concurrent evidence batches with serialized durable writes; UI completed/total batch progress; each model attempt has a 90-second shared transport/stream deadline and closes callbacks before retry/finalization. This is not a promise that a full validated report finishes in 90 seconds.

Validation: API research unit lane 261 tests before final callback test, chapter lane 89 after final change, evidence lane14; UI30; API/Web typecheck; API lint and affected Web lint. Independent reviewer103tests, no remaining findings. Local API restarted after old request was terminal; shared database services retained. Real browser retry uses existing two chapters; outcome recorded in issue.

```mermaid
flowchart LR
 A[Inspect durable report] --> B[Fix progress and bounded work] --> C[Tests and real recovery] --> D[PR and CI]
 classDef tested fill:#ddd6fe,stroke:#7c3aed
 classDef doing fill:#fde68a,stroke:#d97706
 class A,B tested
 class C,D doing
```
