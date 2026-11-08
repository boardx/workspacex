# Official digital human activation and card status (#6436)

User wants category/short description beside the avatar/name, and upper-right activation status. Current UI changes pass49focused regressions plus10final panel cases (overlapping, not summed) and1fixture-backed desktop/mobile browser scenario: pending→enabling→failure→retry→enabled member directory;4screenshots manually inspected. Browser fixtures prove presentation only.

Live production retry through the requested action reproduced dependency5x200/3x409 SKILL_STARTER_PACK_CONFLICT, then official roles2.0.0 import422 UNRESOLVED_WORKFLOW_REF, all26allowlisted workflows missing. Safe trace605f0617-cf33-420f-80bd-3aab080419ac; no credentials, headers or organization identity recorded. No official roles were enabled by that failed request; completed dependency imports may remain.

Root cause: API runtime FileWorkflowDefinitionStore reads canonical requirements/work-stack-v2/workflows; Docker sources stage omitted that directory. Real HTTP/PG production-shaped missing-assets regression reproduces the identical26missing references. Fix copies canonical docs and admission checks every actual role workflow using the same resolver/store as runtime. Missing-root admission exits1; present-assets admission reports7roles/8packs/26workflows. Focused real HTTP/PG post-fix chain passes and validates replay/memberdenial, with two image-admission script cases passing separately. These do not yet attest an actual rebuilt runtime image or production recovery.

Pending: final affected checks, actual Docker artifact evidence, exact-SHA independent review, PR/CI. Reuse existing session worktree, no new worktree, no production deployment.

Final checks checkpoint: affected typecheck/lint33/33 passed. Existing localized-package compatibility focused case passed1 with1unselected; first attempt's assertion that conflicts must occur was invalid (actual compatible imports had0conflicts), retained as test-fixture assumption failure, with no production code change. Docker source-stage actual build is next; no claim that production was repaired yet.
