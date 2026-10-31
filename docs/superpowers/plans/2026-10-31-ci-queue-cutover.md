# Develop merge queue cutover

Tracking: #6055, parent #6052. User authorized remaining queue and post-merge dedup stages.

## Frozen prerequisites
- #6053 merged at 924ec90dd32732c577ebf3d4e508d8bbe68e2706, with35successful/1conditional skipped checks and independent head review.
- Separate develop-only ruleset26262460 enables ALLGREEN queue, MERGE, one concurrent candidate/one PR per merge,90-minute check timeout. Existing required-check/review/bypass rules are unchanged; no production branch rule modified.
- Original rules and additive queue request/response snapshots are retained in the task output evidence. Live authority remains GitHub rules API, not this dated observation.

## Candidate acceptance
The PR containing this document must enter the queue through normal GitHub admission, never admin bypass. Record candidate SHA, base SHA, merge_group run IDs, required/aggregate check conclusions and final merge commit. Only observed queue execution proves the queue works; ruleset existence alone does not.

ci-queue-wiring.test.ts checks every required producer and dependency remains reachable on merge_group; regression mutations cover missing trigger, path filters, skipped dependency, missing API planner, wrong checkout and duplicate producers. Actual failure/cancel/missing evidence semantics retain existing aggregate/merge-queue tests. No intentionally broken production change or fake check status is used.

## Stage3 prerequisite
Keep push fallback until this real candidate has successfully merged. Then change source verification to PR+merge_group and publish images only after authenticated successful candidate evidence for the exact integration source (or an explicitly verified immutable tree equivalence if GitHub emits a different merge SHA). Preserve artifact build validation, migration/config admission, deployment health/business acceptance and recovery behavior. Different SHA is never silently called same-SHA evidence.

```mermaid
flowchart LR
 A[Merge stage1] --> B[Enable additive queue]
 B --> C[Actual candidate]
 C --> D[Verified source evidence]
 D --> E[Remove equivalent push regression]
 classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
 classDef doing fill:#fde68a,stroke:#d97706,color:#111827
 classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
 classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
 classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
 class A done
 class B done
 class C doing
 class D todo
 class E todo
```
