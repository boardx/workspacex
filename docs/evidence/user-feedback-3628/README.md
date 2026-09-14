# Feedback tags — issue #3628

Scope: the product feedback dialog shown in the issue attachment, both compose and review steps, plus saved draft editing. Uses the existing standard TagInput; no separate tag widget behavior.

Tags are optional for existing clients. Submitted feedback writes tags into the existing org-scoped inbox_item_tags authority in the same transaction as the feedback insertion. Drafts hold a private tags array until submission; omitted PATCH preserves tags and [] clears them. AI refinement leaves tags unchanged. Read visibility follows feedback detail visibility; historical administrator tags remain readable.

GitHub issue drafts combine current persisted tags with user-feedback and the feedback-kind label, deduplicated case-insensitively. The feedback creation boundary removes internal coordination/review label namespaces, documented in .harness/instructions/multi-agent-coordination.md; classification text cannot become an agent assignment or review verdict. The shared fetch adapter resolves labels before creating an issue: GET, only 404 allows POST, concurrent 422 requires a successful confirming GET. Failures stop before issue creation. No external test issue was created, and no automatic merge was enabled.

## Verification

- init.sh: dependency installation and quick health checks passed (its default quick mode; not full repository validation).
- harness readiness executed; this issue is the user's explicitly authorized feedback queue assignment, recorded in the issue comment.
- UI: 51 tests passed, covering existing dialog/draft behavior, IME, case deduplication, unconfirmed tag on direct submit/save draft, and persisted draft edit payload.
- Contract: 2 tests passed, covering legacy input and workflow-label isolation.
- Real isolated PostgreSQL: feedback and draft tags read back correctly, cross-tenant and owner isolation, [] clear, update preservation, submit into the inbox authority, and rollback of feedback insertion on tag storage failure. The feedback submission/attachment/draft-deletion sequence retains its pre-existing separate-transaction semantics; this change only makes feedback+tags insertion atomic.
- Real Chromium: desktop 1280 and mobile 375, add/remove/backspace/case deduplication, unconfirmed tag submission, draft save/reload/edit/submit. Screenshots and runnable script adjacent. Network fixtures are explicit UI transport fixtures; they do not prove authentication or live backend storage. Database tests independently exercise actual storage, and fetch-adapter tests exercise GitHub request ordering/payload/failure behavior.
- API and web typecheck, API lint, web ESLint passed.
- API pure unit lane includes the shared design-workbench issue creator use case; it runs no database setup. The canonical database isolation configuration is unchanged.

The issue attachment was inspected and matched to the product feedback dialog. Mobile screenshot shows the existing scrollable dialog, with tags in its content area.

## CI correction

The first gates-runtime run found that the new draft tags migration was not replayable (the column already existed on the second application). Added IF NOT EXISTS and ran the unchanged isolated `pnpm --filter @repo/api migrate:check` successfully: empty rebuild, individual replay, populated data identity, prototype append-only behavior, and version-table coverage all passed. Full output is retained in migration-check.txt. This does not alter any verification gate.
