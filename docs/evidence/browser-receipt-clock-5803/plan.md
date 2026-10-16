Investigate the existing expired browser receipt assertion blocking payment verification, then correct only a proven fixture-clock mismatch. Preserve production SQL/security deadlines, late completion/restart/concurrency/cancellation assertions and original timing budgets. Use owned isolated PostgreSQL; no OS clock changes or shared database mutation. Original F07 failure is not a passing result.

```mermaid
flowchart TD
  G[Make the receipt deadline verification authoritative]
  S1[Inspect actual claim failure and SQL time authority]
  S2[Measure host and database clocks in isolation]
  S3[Correct only the proven test fixture cause]
  S4[Verify real database and retained negative paths]
  S5[Submit isolated PR and follow CI]
  G --> S1 --> S2 --> S3 --> S4 --> S5
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
  class G doing
  class S1 done
  class S2 tested
  %% evidence S2: probe.log6pass not historical reproduction; red.log controlledskew2fail6pass establishes fixture mechanism.
  class S3 tested
  %% evidence S3: review-red.log 1fail8pass then review-green.log9pass at45d5a474f; same-session clock+claim preserves100ms/150ms.
  class S4 tested
  %% evidence S4: review-verification-receipt.json: realPG9pass/typecheck/lint/OSS0/SOURCE ACCEPT45d5a474f; ownedstacksabsent.
  class S5 doing
```
