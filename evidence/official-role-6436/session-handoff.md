# #6436 handoff

User scope: move category/short description beside avatar/name, show upper-right activation status, fix official digital-human activation. Reused session worktree and codex/official-role-enable-status branch; no new worktree. Product source c086514c independently reviewed with no P1/P2; final increment is evidence only.

Root cause is missing workflow definition assets in API Docker sources stage, yielding actual production422 UNRESOLVED_WORKFLOW_REF all26. Fix COPY canonical workflowdocs and verify all actual allowlist references via shared runtime/image resolver. No registration/authorization bypass. UI pending/enabling/failed and enabled-directory badges; specific safe missing-workflow explanation.

Validation: UI49+final10 overlapping (not additive), deterministic desktop/mobile browser1 with4screenshots; real missing-assetred identical26 then full HTTP/PGchain1green, image-admission2green, localized-existing1green1unselected; affected33/33. Actual source-stage Docker build and nonroot/readonly/offline26-reference probe passed, missing-root probe exits1. Not a full runtime image build or deployment; production activation must be verified after release. See progress.md and validation/. One production repro retry imported/replayed dependencies but role activation failed; no successful production enable claimed.

All owned stacks/probe containers/browser3199 cleaned; source image tag removed. Pending automatic PR creation and remote CI, then normal integration only. No production deployment authorized/performed.
