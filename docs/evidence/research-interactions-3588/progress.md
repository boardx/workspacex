# Research interactions — #3588

Direct user fix: URL-opened research reports could not return to history because the stale session prop overrode the cleared local session. Explicit conversational regeneration also went through the full-report editing/citation path before generation.

Navigation now uses the active local session while synchronizing genuinely changed route props. Explicit affirmative whole-report regeneration reuses the existing durable generation path, retains messages and ignores unapproved editor content. Negative/question/edit messages stay on the proposal path. Report messages use the existing stream observer without client-side intent duplication.

Regression tests initially failed for Back navigation and conversational progress; API tests demonstrated the editing-path error. Source/quality gates remain intact and failed generation retains prior content through the existing history mechanism. Full-stack coverage now includes actual conversational regeneration, Back, reload and reopening the saved report.
# CI follow-up

The first full-stack run reached successful conversational regeneration, but a page-wide alert assertion also counted Next's global route announcer. Scope the assertion to the research flow and additionally verify the persisted report, successful assistant reply, new model calls, cleared busy state and null error code.

Independent review also identified a stale report draft displayed during conversational streaming. A regression reproduced it (11 passed, 1 failed); server generation snapshots now select the same loading state as direct generation without client-side intent classification or loss of recovery drafts. Final validation follows on the PR.
