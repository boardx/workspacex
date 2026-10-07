# Research synthesis citations — #5502

The user response retained five chapter checkpoints, with two chapter quality warnings, but synthesis failed twice with `RESEARCH_CONTENT_REFERENCE_INVALID`. The synthesis copied the real source ID `1c4eff92-d4f3-4742-bb0b-9b30f56b332e` as `1c4eff92-d4f3-4772-bb0b-9b30f56b332e`. Both attempts contained the unknown ID. Strict rejection was correct; generic repair did not explain the rejected citation.

Synthesis context now uses exact stable short aliases in chapter bodies and source lists, with the existing canonical mapping. Field-specific private repair feedback identifies unknown, untrusted, malformed or URL references. Unknown IDs still fail; no fuzzy correction, dropped citations, additional retry, changed quality gate or new whole-run timeout.

Validation: initial regression failed on canonical IDs in synthesis context; fixed focused suite 102 PASS; complete pure research suite 27 files / 602 PASS; API typecheck and lint PASS. Independent read-only review ACCEPT.

Real local API continuation used the existing session and normal login, with one report retry. Three quality-passed chapters were reused (zero chapter/review attempts). Two warned chapters were retried and remain warned. Synthesis succeeded on its first attempt in 11.446 seconds. Final validation correctly rejected publication with `RESEARCH_REPORT_QUALITY_INSUFFICIENT`; a report draft was saved. The citation failure is resolved in this real run; complete formal-report acceptance is NOT achieved. See `real-continuation.json` for safe status/timing metadata. Do not represent this as completed report generation or global latency improvement.

The current local API serves the candidate in the existing worktree. No database reset, production deployment or merge was performed for this repair. Source bodies, credentials and model output are not included in evidence.

## Follow-up complete report verification

Chapter prompts now use exact short aliases throughout source/evidence/previous-chapter/revision contexts; persisted citations remain canonical. Review context shares identical source/quote pairs losslessly. Review instructions distinguish specific acknowledged evidence gaps from omitted answers. The one known nested question issues field is moved losslessly into canonical top-level issues; unknown fields/types/IDs still fail. Strict review JSON may be repaired once without regenerating prose. Mechanical guards forbid removal of recoverable negative support/depth/missing verdicts or issues.

Final pure research suite: 27 files / 613 PASS; API typecheck PASS; API lint PASS. Independent review requested and the negative-verdict preservation finding addressed with code and a regression.

Real normal-auth local continuation version 14 completed in 109.862 seconds: four approved chapters reused with zero chapter/review attempts, remaining chapter generated/reviewed once, synthesis once, final validation completed, report persisted, no chapter warnings. See real-completed-continuation.json. This is continuation latency, not a new full-run SLA. An earlier evidence-provider timeout and earlier negative quality results are not represented as success. Evidence extraction still made 11 calls; this change does not claim to eliminate that cost.

Chrome reload of the existing report URL recovered the saved named report, all three UI steps completed, five chapters, about 11,835 characters and 26 citation sources. The quality gate correctly retains “带限制完成 / 核心问题覆盖不足”; missing public metrics are not represented as verified facts. The UI source-reading row remains “待核实”, matching the retained evidence limitations. No deployment or merge.
