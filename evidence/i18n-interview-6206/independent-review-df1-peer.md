# Incremental independent review — interview #6206

**CLEAN: no actionable P1/P2 found in this incremental frozen delta. Fresh browser acceptance is still unverified.**

## Exact scope

Base `ec3694617552c440ea078f7abb1f7bb8f21dd4d6` → head `df1de9e87ac431e74058c0aa1ab249c917b4fd25`.

Reviewed the complete supplied incremental package and exact Git objects: 38 changed files, including all 10 non-evidence files below. The earlier 109-file review was not repeated. Focused reads of unchanged frozen dependencies established the real confirm/revision behavior, metadata-dialog dependencies, search placeholder, shared filter callers and translation aliases. Only this report was written; no source edits, tests, browser, build, typecheck, lint, PostgreSQL, GitHub, checkout or subagent work occurred.

## Conclusions

1. **Revision acceptance is consistent with the actual product path.** Frozen `interview-markdown-editing-step.tsx` confirms a generated outline and proceeds to runs after expert confirmation. The new E2E waits for the runs route and enabled report action, reads the API envelope, asserts execution completed, returns to outline, and asserts the question is disabled. It then accepts the actual revision confirmation, uses the actual UI action, checks the changed revision ID and increased envelope version, and checks copied outline Markdown before editing. Subsequent locale retention, API persistence, reload, reconfirmation, report/reference and history assertions remain. No pending/immutable guard, product operation, fixture response, timeout or report validation was changed. This repairs the test's assumed route, rather than manufacturing an editable confirmed document.
2. **No new false-positive shortcut found.** The revision is neither fabricated through page routing nor preseeded via API. The test reads the real authorized API and requires a different revision before editing. Its scope is not a proof of historical revision immutability: it does not reread the old revision after the new save. The new initial execution wait still uses the normal assertion timeout, so successful execution under load remains to be demonstrated. Neither observation establishes a source defect in this localization delta.
3. **Shared filters preserve behavioral values.** `business` is interpolated display text only in the filters, tag group and metadata/deletion UI. Locale is passed to the existing `searchPlaceholder`. The `recent`/`oldest` state, toggle callback, raw query, tag values, prefixes and test IDs remain unchanged. Metadata reset effects do not depend on `business`, so translating the caller does not itself reset name/tag drafts. Shared sort labels reuse research resources with the same `{sort}` placeholder; no query alias is introduced.
4. **Plural resources use the existing translator contract.** The new `.one`/`.other` resources preserve `{count}`, match English singular/plural selection, and keep Chinese text equivalent. The completed-expert label uses a count-neutral heading while retaining both numeric values. Singular management `interview` and plural search `interviews` are deliberately distinct display labels. No canonical enum, Markdown, ID, payload, cache key or generated-model text changes.
5. **Shared caller limit remains explicit.** The transcription caller still passes raw `business="转录"`; English generic chrome can therefore surround that Chinese display noun. That caller's full localization is not delivered by this incremental interview change and should not be claimed. Its raw query/tag/sort semantics are preserved. The recorded regression suite includes both transcription-history callers.

## Recorded evidence and unverified boundaries

The second browser run is **FAIL**, not acceptance. Its retained log reports the vanished/disabled outline locator; the sanitized network summary records outline generation 201/v8 draft, confirmation 201/v9 confirmed, and execution 201/v12 completed. That sequence agrees with the inspected product control flow. It does not show that the new revision route or later report/history assertions have passed.

The recorded visual counterexamples report 13 failures and 6 passes before correction; the subsequent related suite reports 7 files and 128/128 passing cases. These are reviewed receipts, not independently rerun checks. Owner-reported type/lint/wiring/test-ID results do not replace a fresh browser run at the final candidate. This reviewer did not independently inspect the new binary screenshots or revalidate the original trace hash. Prior limits on real-model quality, exported bytes, external ASR, native Skill execution and browser coverage of other overlays remain.

The capture change resets main/dialog scroll positions before screenshots. It does not change form values, model state or request behavior. Horizontal geometry checks remain; vertical usability at short heights is still outside the test's height-900 evidence.

## Prior minor ledger item

Unchanged and non-blocking: `apps/web/app/itv/live/page.tsx:41` maps `proposed`, while the contract `OutlineStatus` is `pending_confirm | confirmed`; line 283 would expose `pending_confirm` raw. The current frozen `getInterview` path returns null status, so there is still no demonstrated current-path P2. The direct status-map lookup also lacks an own-property fallback for malformed responses. Preserve this item for the owner when that endpoint exposes outline status; this delta neither fixes nor worsens it.

## Complete incremental non-evidence coverage

- `apps/web/components/itv/interview-history-card-actions.tsx`
- `apps/web/components/itv/interview-studio-home.tsx`
- `apps/web/components/studio/studio-history.tsx`
- `apps/web/e2e/i18n-interview-journey.spec.ts`
- `apps/web/lib/i18n/messages/en.ts`
- `apps/web/lib/i18n/messages/zh-CN.ts`
- `apps/web/lib/i18n/namespaces/interview.ts`
- `apps/web/lib/i18n/namespaces/studio-history.ts`
- `apps/web/tests/lib/interview-ui-text.test.ts`
- `apps/web/tests/ui/interview-history-i18n.test.tsx`
