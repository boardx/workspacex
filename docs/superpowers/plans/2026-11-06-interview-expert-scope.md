# Interview expert scope implementation plan

User request: prevent duplicate expert question groups and remove leading notices from the runs screen. Reuse current e6f1 worktree, fetch main/develop before development; branch from develop. Issue#6337.

- [x] Read-only reproduce the actual linked/unlinked headings and trace execution context.
- [x] RED→GREEN tests for per-expert context, retry fragment isolation, immutable transcript projection and same-level insights.
- [x] Scope only model input/continuation and transcript display; preserve source Markdown and evidence/report guards.
- [x] API/web typecheck, targeted PostgreSQL/UI/unit suites and independent review.
- [x] Complete full serial interview database regression after parallel fixture deadlock; clean owned DB stack.
- [ ] Open PR, follow CI and document exact SHA/results. No production deployment implicit in this plan.

Review ruling: filtering a foreign expert section cannot end at an arbitrary same-level heading; subsequent insight sections otherwise leak into the current task’s summary. Fixed and independently rechecked.

Validation evidence: full serial DB87files/1050pass/1skip, UI41pass, context/execution17pass; independent review P2 resolved and rechecked.
