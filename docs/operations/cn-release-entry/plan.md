# Persistent CN release entry (#5623)

Implement a bounded executor and parameterized continuation generators on the existing Shanghai runner. Preserve canonical admission and stage bindings. Persist intent before execution, supervise the actual process tree, and reconcile uncertain writes without replay. Complete the one-request whole-chain connection and real public acceptance before claiming the user's goal achieved.

```mermaid
flowchart TD
  G([Reusable release with a measured 30-minute target])
  S1[Read actual host capabilities]
  S2[Durable entry and parameterized generators]
  S3[Local real-process and canonical tests]
  S4[Independent review and Linux CI]
  S5[Whole-chain root derivation and observers]
  S6[Approved installation and cloud E2E]
  G --> S1 --> S2 --> S3 --> S4 --> S5 --> S6
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
  class G doing
  class S1 tested
  class S2 tested
  class S3 tested
  class S4 doing
  class S5 doing
  class S6 blocked
  %% evidence S1: root readonly probes 17:26:48Z and 17:54:22Z, exact wrapper hashes and cgroup2 capabilities
  %% evidence S2: 27 entry, 33 parameterized continuation, 9 derived approval tests PASS
  %% evidence S3: real subprocess handshake/timeout/reconcile and canonical seven-ZIP plus original materializer integration
  %% blocked S6: exact installation and permissions require approval; real cloud business E2E and 30min target unverified
```

No installation, sudo or IAM change occurs during development. Unknown execution does not permit retries under a different package or stage name. The stage dispatcher and four-phase derivation are implemented; whole-chain approved generation, live readiness and terminal/business observers remain explicit work, not completed production capability.
