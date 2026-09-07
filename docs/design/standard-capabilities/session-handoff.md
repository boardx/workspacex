# Continuation checkpoint (2026-09-07)

## Active checkpoint after the core release

The core delivery from PR #2869 and deployment hotfix #2922 is merged and released at
main `a1bd028a`. Deferred acceptance is now tracked by umbrella issue #2916 and its
independently mergeable child issues:

- #2929: persistent Native runtime wiring, admission, drain, and recovery on DevApp.
- #2930: bounded S013 real-model publication and browser security acceptance.
- #2931: governed file artifacts returned from durable T042 subtasks.
- #2932: safe ASR configuration probe and real supported-vendor S016 acceptance.
- #2933: finite Office editing acceptance for S003-S005.
- #2934: context negative paths and current-version acceptance for S001/S002/S008/S011/S014.
- #2935: S012 write denial and S018 revoked parsed-cache acceptance.

The first implementation wave can run #2929, #2932, #2933, and the account-independent
parts of #2934 in parallel. #2931 and the online portion of #2935 depend on #2929. The
online portions of #2930 and #2934 require a current DevApp test-account preflight. #2932
must establish ASR configuration with a safe PRESENT/MISSING probe before attempting a
vendor transcription.

Use [development-flow.md](development-flow.md) as the current implementation map. The
checkpoint below is retained as a historical record of the pre-merge aggregate branch;
its ownership, merge authorization, SHA, and remaining-work statements are no longer the
active plan.

Worktree: `/private/tmp/workspacex-standard-capabilities`; branch `codex/standard-capabilities`.
Tracking issue #2864; aggregate draft PR https://github.com/boardx/workspacex/pull/2869 .
User authorized development code and test evidence on that public branch, without merging main. Temporary module-agent identity waiver remains. Root owns git and shared kernel integration; never stage all files or reset a worker's changes.

Use [development-flow.md](development-flow.md) as the current status and evidence entry point; do not carry forward old SHA test conclusions. Latest local task commits are d3d5baf2d (verified meeting minutes) and 51c85cf7f (reproducible analysis source delivery). Last public checkpoint is b8352e879.

## Active ownership

- claude_research: real-model method, canvas, authoring and visual Skill cases; own sandbox only.
- current_runtime_audit: remaining S001-S008 real-model cases; S007 passed and committed.
- langchain_research: native artifact download, run status/cancel, visibility and actual byte-delivery verification. Kernel dependency injection is root-owned and wired; latest integrated API typecheck passed.
- Root: Office/browser private patch integration, review, commits, Mermaid and PR CI.

Database wrappers run one at a time with direct worker handoff. All fixtures use synthetic inputs; secrets stay in process. Do not touch peer containers or ports. Preserve failed runs and actual corrections.

## Remaining integration

Office minimal patch is being delivered privately in six segments, SHA and exact-base reconstruction required. Browser actual Chromium revealed boolean form values and screenshot path faults; cloud incremental fixes require local execution before green. Native T042 cloud patch is incomplete locally; a private segment request was rejected by automatic approval review and was not bypassed. Public writes to newly invented cloud branches were also rejected; use only authorized scope and do not route around review.

S016 ASR provider configuration remains missing; user input is pending. Do not equate protocol fixture tests to actual vendor recognition quality.

Peer task `agent ux dev` (01a07700-7c3c-7402-9855-d7dc9f9fcf5e) confirmed its PR2909 merge 8aeb7f57b3edf500bbe00f954b96d6a489e24d16 does not fix Skill picker overflow; it now owns that UI fix and will reply with SHA/evidence. No overlapping UI edits. Preserve STEP events and planning fallback when no streamed text exists.

## Completion discipline

Finish remaining catalog behavior, per-Skill real-model evidence and current-SHA CI/review. Mermaid colors describe verified scope, never invented feature passing. No main merge is authorized. Clean only self-owned stacks, preserve all unfinished ownership, and update this entry point after integration.
