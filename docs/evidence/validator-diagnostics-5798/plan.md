# Validator diagnostic baseline task #5798

Goal: distinguish the observed VALIDATOR_UNAVAILABLE cause without changing validation, deadlines, fresh worker heaps, admission limits, public error codes or financial source. This task does not claim the original failure is fixed.

Directly assigned payment verification is blocked on the baseline; the readiness exception is recorded in issue5798. Original source0579448 failed the imported5k real-PG case after977 successful files; the earlier original occurrence passed. Logs cannot establish the cause.

```mermaid
flowchart TD
  G[Diagnose validator availability failure]
  S1[Retain original failure and inspect boundaries]
  S2[Define deterministic safe-diagnostic counterexamples]
  S3[Add fixed-code failure diagnostics]
  S4[Run unchanged real worker and PostgreSQL growth cases]
  S5[Independent review and separate PR]
  G --> S1 --> S2 --> S3 --> S4 --> S5
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
  class G doing
  class S1 done
  class S2 tested
  %% evidence S2: diagnostics-red.log -7fail1pass; non-error-red.log -2fail; diagnostics-green.log -12pass
  class S3 done
  class S4 tested
  %% evidence S4: real-focused.log:6files46tests including unchanged real5k/10k/PG; APItype/lint/OSS0 atf60a9f1ae. Original fault not reproduced.
  class S5 doing
```
