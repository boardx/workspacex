# Follow-up: preserve the historical question's student-recorded source revision

Independent review identified ambiguity when returning to step 5: the historical reflection could reference an older verification question while `sharedStageContext` correctly contained the current fifth-stage revision. The return DTO now includes `questionSourceStageRevision: number | null`, taken exclusively from `readAidtQuestionSnapshot(round.content.draft).sourceStageRevision`. It does not borrow `sourceStageRevisions`, the latest stage revision, or a service-verification claim.

The read-only panel displays the historical fifth-stage version separately from current shared material, or explicitly says that no shared version was bound. TeachingContext states that this is a student-recorded historical question binding, unverified, and that the Agent must not substitute the current fifth-stage version. Existing untrusted-material and evidence-not-verified markers remain. The primitive metadata is separate from the text truncation budget, so a long excerpt cannot erase this source distinction. There is no new backend/reference contract or extra request.

## Verification

- `source-revision-red.log`: precise source-revision test fails before the field is added (1 failed / 7 skipped).
- `source-revision-green.log`: full affected loader and host suites pass (2 files / 43 tests). Regression distinguishes historical question V2 from both a conflicting stage reference V99 and current fifth-stage V99; null stays null without inventing a binding.
- `source-revision-lint.log`: targeted production-file ESLint, zero warnings/errors.

Commands from `apps/web`, with the same Node22/pnpm9 tool PATH as the initial delivery:

```sh
WORKSPACEX_WEB_TEST_MAX_WORKERS=1 node_modules/.bin/vitest run --config vitest.config.ts tests/aidt-chat-return-context.test.ts tests/ui/project-aidt-chat.test.tsx
node_modules/.bin/next lint --file features/aidt/components/project-aidt-chat.tsx --file features/aidt/lib/aidt-chat-return-context.ts
```

This remains unit/host verification. It does not establish real model behavior, live database access or classroom acceptance. Parent wiring and integrated typecheck remain root-owned; the parent file is untouched.
