# Research synthesis citations — #5502

The user response retained five chapter checkpoints, with two chapter quality warnings, but synthesis failed twice with `RESEARCH_CONTENT_REFERENCE_INVALID`. The synthesis copied the real source ID `1c4eff92-d4f3-4742-bb0b-9b30f56b332e` as `1c4eff92-d4f3-4772-bb0b-9b30f56b332e`. Both attempts contained the unknown ID. Strict rejection was correct; generic repair did not explain the rejected citation.

Synthesis context now uses exact stable short aliases in chapter bodies and source lists, with the existing canonical mapping. Field-specific private repair feedback identifies unknown, untrusted, malformed or URL references. Unknown IDs still fail; no fuzzy correction, dropped citations, additional retry, changed quality gate or new whole-run timeout.

Validation: initial regression failed on canonical IDs in synthesis context; fixed focused suite 102 PASS; complete pure research suite 27 files / 602 PASS; API typecheck and lint PASS. Independent read-only review ACCEPT.

Real local API continuation used the existing session and normal login, with one report retry. Three quality-passed chapters were reused (zero chapter/review attempts). Two warned chapters were retried and remain warned. Synthesis succeeded on its first attempt in 11.446 seconds. Final validation correctly rejected publication with `RESEARCH_REPORT_QUALITY_INSUFFICIENT`; a report draft was saved. The citation failure is resolved in this real run; complete formal-report acceptance is NOT achieved. See `real-continuation.json` for safe status/timing metadata. Do not represent this as completed report generation or global latency improvement.

The current local API serves the candidate in the existing worktree. No database reset, production deployment or merge was performed for this repair. Source bodies, credentials and model output are not included in evidence.
