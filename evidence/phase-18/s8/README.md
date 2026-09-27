# Phase 18 · S8 (#4365, epic #4359) — memory consolidation, 「值得记」 pre-gate, extraction SLOs

Branch `claude/s8-consolidation-gate-slo`. No PR opened by the worker (coordinator decides).

## What shipped

| Part | Where | Default |
|---|---|---|
| Per-user consolidation job: duplicate claims merged (all sources kept), entity spellings merged (edges repointed), contradictions opened as **F16 conflict cards** (never auto-resolved). Every change is recorded with its original values and can be undone by the owner. | `domain/knowledge-graph/consolidation.ts` (plan, pure), `application/knowledge-graph/consolidate-memory.ts`, migration `20260928180000_kg_s8_consolidation_slo.sql` (`kg_consolidation_*` functions, runs + changes tables), `infrastructure/knowledge-graph/kg-consolidation-worker.ts`, `pg-kg-consolidation.ts` | **Off** (`kg_consolidation_state.enabled = false`) until a human turns it on in 平台后台 → 运营状态 |
| 「值得记」 pre-gate before the extraction model: rules skip greetings, short acknowledgements and pure questions; goal / preference / decision / memory-instruction messages are **never** skipped; optional cheap-model check behind `KG_EXTRACTION_GATE_MODEL=1`. Skips are logged (`kg extraction skipped: not worth remembering`, `reason`) and counted as model calls saved. | `domain/knowledge-graph/worth-remembering.ts`, `application/knowledge-graph/extraction-gate.ts`, `infrastructure/knowledge-graph/model-worthiness-check.ts`, wired in `extract-message-knowledge.ts` | Rules on; model check off |
| Extraction SLOs: p95 latency, failure rate (this instance, last hour), stuck leases (whole deployment, DB count). Breach ⇒ one `error` log `kg extraction slo breached` (`code: KG_EXTRACTION_SLO_BREACHED`) on entering / changing, `info` on recovery; admin banner. Thresholds: `KG_EXTRACTION_SLO_P95_MS` (120000), `KG_EXTRACTION_SLO_FAILURE_RATE` (0.2), `KG_EXTRACTION_SLO_STUCK_LEASES` (0). | `domain/knowledge-graph/extraction-slo.ts`, `application/knowledge-graph/extraction-slo-recorder.ts`, `kg-extraction-worker.ts#checkSlo`, `kg_extraction_slo_counts()` | On |
| Admin view next to the deployment extraction toggle; owner's 「整理记录」 with undo on /brain. | `apps/web/components/admin/memory-ops-panels.tsx`, `apps/web/components/brain/consolidation-history.tsx`, `apps/web/lib/live-memory-ops.ts` | — |

Contract (`packages/contracts/src/chat-knowledge-graph.ts`, **treated as approved, sign off later** — listed in
[`../r10/README.md`](../r10/README.md) §3.2): `getPlatformExtractionSlo`, `get/setPlatformConsolidationSetting`,
`runPlatformConsolidation` (platform operators), `listMyConsolidationRuns`, `undoConsolidationRun` (owner only), error codes
`KG_CONSOLIDATION_RUN_NOT_FOUND`, `KG_CONSOLIDATION_DISABLED`.

## Review round 1 (PR #4491, REVISE) — what changed

- **H1 undo sticks**: pairs the owner undid (`kg_consolidation_changes.status = 'undone'`) are returned by
  `kg_consolidation_candidates` as `undone` and excluded by the plan; the DB apply / open-conflict functions refuse them
  too (`kg_consolidation_pair_undone`). A re-undo of a partially undone run is `KG_CONSOLIDATION_RUN_NOT_FOUND`.
- **H2 conservative duplicates**: besides numbers / negation / kind, a merge now needs equal about-entity sets (after the
  entity merge) and an empty symmetric difference of content tokens (CJK bigrams with function characters removed, Latin
  words, numbers). 「负责人是张三 / 李四」「上海 / 北京」「Python / Go」 no longer merge.
- **M1**: a merge is skipped when the kept claim has no supporting evidence of its own; undo keeps the copied supporting
  evidence if the kept claim has none left besides it (so F07 cannot revoke the kept claim).
- **M3**: SLO p95 is computed over model jobs only (gated jobs excluded).
- **L3**: undo reads the run back by id, not from the recent-N list.
- **M2 (known behaviour, not changed)**: edges pointing **into** a merged-away claim (supersede / decision-history,
  `supersedes` / `derived_from` from other claims) are **not re-pointed** to the kept claim. F07's cascade invalidates
  them when the duplicate is soft-revoked, and undo restores them (their ids are in `restore.edges_invalidated`). Only the
  duplicate's own outgoing `derived_from` / `about` edges and its evidence are copied onto the kept claim.

## Integration point for s4 (per-message outcome table)

No competing table was created. A gated message completes its queue row like any other skip and leaves one structured
log line (`reason` ∈ `greeting | acknowledgement | pure_question | model_not_worth`). When s4's outcome table lands,
write `skipped + reason` at the `gated` branch of `extractJob` (`extract-message-knowledge.ts`), and the SLO window can be
computed from that table instead of the in-process recorder (multi-instance accurate).

## Tests (all new tests have fail-without-fix proof)

- `apps/api/tests/knowledge-graph/worth-remembering-gate.test.ts` — golden set read **from** `self-intent-claim.test.ts`
  and `decision-claim.test.ts` (no copy), every phrase is never skipped; protected phrases never reach the cheap model;
  model error ⇒ extract + `KG_GATE_MODEL_FAILED`; tick wiring (skipped messages do not call the extractor).
- `apps/api/tests/knowledge-graph/extraction-slo.test.ts` — p95 / failure rate / thresholds; worker alert logs once, recovers.
- `apps/api/tests/knowledge-graph/consolidation-plan.test.ts` — the merge gates (numbers, negation, kind, contested,
  cosine + lexical, lexical only), keeper choice, chain groups, entity merges, conflicts.
- `apps/api/tests/knowledge-graph/consolidation-db.test.ts` — real Postgres; memories produced by the real F06 extraction
  + auto-copy path; consolidation merges / repoints / opens the card; owner-only list; undo restores everything; a card the
  human already resolved is `undo_skipped` with a reason; stuck-lease count and the SLO endpoint shape.
- `apps/web/tests/ui/memory-ops-panels.test.tsx`, `apps/web/tests/brain/brain-screen.test.tsx` (one route added to the stub).

Fail-without-fix: [`fail-without-fix-api.txt`](fail-without-fix-api.txt) (M1–M6) and
[`fail-without-fix-web.txt`](fail-without-fix-web.txt) (W1–W3); scripts in `harness/`.

## Browser evidence

See the screenshots and `journey.json` in this directory (produced by `harness/s8-evidence.spec.ts.txt` against the
stack in `harness/stack.sh.txt`, data seeded by `harness/s8-evidence-seed.ts.txt` through the real extraction pipeline).
