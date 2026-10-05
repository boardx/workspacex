# Progress

Issue #5359 implements the user's cancellation of a round-level three-minute cutoff. Search optimization and the ten-minute whole-report soft target remain #5306.

```mermaid
flowchart LR
 A[Inspect timers and Google call graph] --> B[Remove round deadline retain bounded calls] --> C[Virtual time and controlled browser recovery] --> D[Independent review and PR CI]
 classDef tested fill:#d8b4fe;
 classDef active fill:#ffe69c;
 class A,B,C tested;
 class D active;
```

API 416 / Web 364 tests pass. Initial UI red and old-deadline counterfactual failures are preserved in private logs. Actual controlled browser reload beyond 266s remained active, and pause settled without a round error. Actual Google-only baseline is recorded separately; no report SLA or live model quality is claimed.
