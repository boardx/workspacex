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
  S6[Share exhaustive worker input protocol]
  S7[Correlate HTTP and WebSocket operations]
  S8[Restore trace across queued admission]
  S5[Independent review and separate PR]
  G --> S1 --> S2 --> S3 --> S6 --> S7 --> S8 --> S4 --> S5
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
  %% evidence S4: review-final-focused.log13files84tests; APItype/lint/OSS0 atcd85446e25a4c97fb010fdcb24151207ddde4f06; original fault not reproduced.
  class S5 doing
  class S6 tested
  %% evidence S6: review-shared-input-green.log and review-shared-input-workers.log: static contract and10 real worker tests passed.
  class S7 tested
  %% evidence S7: review-final-focused.log: actual concurrent HTTP and queued WS operation correlation, unchanged public errors.
  class S8 tested
  %% evidence S8: review-queued-trace-red.log two load failures then review-queued-trace-green.log15pass; review-final-focused.log84pass.
```
