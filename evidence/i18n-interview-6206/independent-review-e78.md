# Independent frozen review — interview #6206

Verdict: **CLEAN for demonstrated P1/P2 defects in the complete frozen source delta. Browser acceptance remains UNVERIFIED.** This is a static review result, not approval to claim the feature passed or to merge.

## Exact source and review method

- Base: `4aa2a1e08443d9cfa1bec718a15e282126098899`
- Runtime/source head: `e78bcc47569c1ba8c9903fa770a222659b8e36a9`
- Additional reviewed delta: `e78bcc47569c1ba8c9903fa770a222659b8e36a9..ec3694617552c440ea078f7abb1f7bb8f21dd4d6`; exactly three E2E capture calls (private detail, analysis, history). No runtime changes in that delta.
- Actual Git inventory: **109 files**, comprising **60 non-evidence files and 49 evidence files**. The assignment's shorthand 98-file count is superseded by the exact Git range.
- Read the supplied inventory/package and the complete non-evidence changes using bounded exact-object `git diff`/`git show` reads. Where long JSX caused output truncation, revisited the missing files/sections using word-diff extraction and focused frozen-source reads. All product files, the entire new namespace, helper modules, all new tests, fixture/provider wiring, configs, and design plan are covered; this review is not limited to the final three `Object.hasOwn` changes.
- Applied the `mod-user-interview` knowledge and canonical/identity/evidence constraints. No checkout, product edit, test, build, lint, browser, PostgreSQL, GitHub operation, or subagent was performed. This report is the only written artifact.

## Findings

No actionable P1/P2 found in the reviewed source range.

One non-blocking compatibility observation: `apps/web/app/itv/live/page.tsx:41` maps `proposed` but not the actual `pending_confirm` member of `OutlineStatus` (`packages/contracts/src/interview.ts:77`). At line 283 a contract-valid `pending_confirm` is rendered raw rather than localized. The same direct object lookup also does not use an own-property check. The current frozen `getInterview` implementation explicitly returns `outlineStatus: null`, so I have not promoted a future/invalid-response case to a demonstrated present P2. When this detail endpoint exposes actual outline status, use the contract enum for the map and an own-property fallback; cover `pending_confirm` and prototype-name malformed responses. The category, quality-reason and import-error paths that accept arbitrary strings already have correct own-property guards.

## Covered behavior and conclusions

- Home/create/history integration: fixed labels translate; creation defaults update while the dialog is closed and freeze once opened; edits, tags and request-attempt identity remain independent of locale. Shared metadata controls are inherited from the base, not newly implemented in this diff.
- Canonical six-step flow: intake/planning/editing/results/session/workbench changes retain Markdown, document/version/revision IDs, dirty baselines, callbacks, CAS and generation-session keys. Error state stores keys/flags instead of translated sentences. Translation is applied at render time rather than being introduced into fetch/generation effect dependencies. Adding a new question intentionally inserts a localized editable default; existing question strings and canonical headings remain unchanged.
- Expert surfaces: directory/picker/category labels use explicit canonical values; arbitrary authored categories remain raw. Private and virtual profile edits, avatar selection, rationale and review notes preserve their state and identity. Reversible profile Markdown field names were moved verbatim to a shared module, not translated in serialization.
- Reports: source/span/version/hash guards, quotations, report body, ownership and approval blocks are unchanged. Translated evidence-mode text is used for display; the export helper deliberately continues to resolve the Chinese default. No downloaded-byte guarantee follows from this review.
- Legacy/setup/quick/live/assistant: inspected all changed branches and overlays. Requests and IDs are not keyed by locale. Mock shortcuts now explicitly prefill editable text and retain a semantic intent until the user edits or sends. Persistent assistant content and proposal IDs remain raw.
- Namespace: read both complete dictionaries and registration changes. Labels and interpolation parameters correspond to the call sites reviewed; canonical field-label and import-error sources are reused. No runtime dictionary execution or fresh parity test was performed.
- Loopback: helper is wired only into the existing test model provider. Operation prefix/system checks gate outline/simulation/report responses; expert IDs and server-bound quotes come from supplied context. Unit tests exercise normalization and report grounding/analysis/claim validators. This is deterministic fixture coverage, not evidence of research quality, actual external-model behavior, or hostile-context hardening. Product authorization, storage and model validation code is not weakened by this diff.

## Browser and evidence boundary

The frozen browser test signs in, writes a private profile, creates an interview, saves canonical intake and outline, executes the six steps, inspects server-loaded citations/documents, and changes history metadata. Locale switches originate from a second page and propagate through the real provider. It checks no extra POSTs at intake/report, source/version stability at report, profile refresh, outline refresh, dirty-navigation cancellation and private-detail close focus. The three extra capture calls are consistent with those paths.

The test captures 375/1280 widths and checks document/dialog horizontal bounds and six-step label fitting. It does **not** establish vertical dialog fit or reachable bottom actions at a short viewport; it uses height 900. It does not exercise every avatar/virtual-profile/picker/assistant/share overlay in a browser, quick/live browser journeys, injected API failures, a completed export download, external ASR or native Skill execution. Those omissions must remain explicit when describing acceptance, rather than treating unit tests as browser evidence.

Reviewed evidence README, validation manifest, recorded pass/failure summaries across all text receipts, and detailed browser failure log. The receipts report 327/327 broad UI cases, 16/16 later prototype-related cases and 6/6 fixture cases. These are historical recorded results, **not checks rerun by this reviewer**. Absolute `/tmp` logs and their hashes were not independently recovered/validated; the binary screenshot was inventoried, not visually reviewed.

The only frozen browser execution is a failure: the original English dialog-name locator became invalid after changing to Chinese. The corrected single-dialog locator plus explicit per-language heading assertions removes that particular source-level mistake, but cannot establish that the rest of the browser flow passes. Fresh execution at the final candidate, actual screenshot inspection, resource cleanup and current PR checks remain required outside this review. No green-browser, green-PR or merge assertion is made.

## Complete non-evidence file coverage

Each file below was reviewed at the frozen range (new files read in full; existing files reviewed for the complete delta plus relevant context):

- `apps/api/scripts/loopback-interview-workflow.ts`
- `apps/api/scripts/loopback-model-provider.ts`
- `apps/api/tests/itv/loopback-interview-workflow.test.ts`
- `apps/api/vitest.interview-markdown-unit.config.ts`
- `apps/web/app/itv/live/page.tsx`
- `apps/web/components/itv/digital-expert-detail.tsx`
- `apps/web/components/itv/digital-interview-create-modal.tsx`
- `apps/web/components/itv/digital-interview-evidence-review.tsx`
- `apps/web/components/itv/digital-interview-quality-panel.tsx`
- `apps/web/components/itv/digital-interview-readiness.tsx`
- `apps/web/components/itv/digital-interview-research-brief.tsx`
- `apps/web/components/itv/digital-interview-setup.tsx`
- `apps/web/components/itv/digital-interview-workflow.tsx`
- `apps/web/components/itv/expert-avatar.tsx`
- `apps/web/components/itv/expert-picker-dialog.tsx`
- `apps/web/components/itv/interview-analysis-step.tsx`
- `apps/web/components/itv/interview-expert-library.tsx`
- `apps/web/components/itv/interview-expert-profile-fields.tsx`
- `apps/web/components/itv/interview-experts-step.tsx`
- `apps/web/components/itv/interview-history-card-actions.tsx`
- `apps/web/components/itv/interview-intake-step.tsx`
- `apps/web/components/itv/interview-markdown-editing-step.tsx`
- `apps/web/components/itv/interview-markdown-planning-step.tsx`
- `apps/web/components/itv/interview-markdown-results-step.tsx`
- `apps/web/components/itv/interview-markdown-surface.tsx`
- `apps/web/components/itv/interview-markdown-workbench.tsx`
- `apps/web/components/itv/interview-outline-step.tsx`
- `apps/web/components/itv/interview-report-generation.tsx`
- `apps/web/components/itv/interview-report-sources.tsx`
- `apps/web/components/itv/interview-report-step.tsx`
- `apps/web/components/itv/interview-runs-step.tsx`
- `apps/web/components/itv/interview-session-provider.tsx`
- `apps/web/components/itv/interview-skill-assistant.tsx`
- `apps/web/components/itv/interview-skill-content.tsx`
- `apps/web/components/itv/interview-skill-drawer.tsx`
- `apps/web/components/itv/interview-studio-home.tsx`
- `apps/web/components/itv/interview-workbench-header.tsx`
- `apps/web/components/itv/quick-digital-interview.tsx`
- `apps/web/e2e/i18n-interview-journey.spec.ts`
- `apps/web/lib/i18n/messages/en.ts`
- `apps/web/lib/i18n/messages/zh-CN.ts`
- `apps/web/lib/i18n/namespaces/interview.ts`
- `apps/web/lib/interview-category-text.ts`
- `apps/web/lib/interview-expert-profile-fields.ts`
- `apps/web/lib/interview-expert-profile.ts`
- `apps/web/lib/interview-intake-error-text.ts`
- `apps/web/lib/interview-quality-text.ts`
- `apps/web/lib/interview-report-export.ts`
- `apps/web/lib/interview-report-failure.ts`
- `apps/web/lib/interview-text-import.ts`
- `apps/web/playwright.fullstack-smoke.config.ts`
- `apps/web/tests/lib/interview-ui-text.test.ts`
- `apps/web/tests/ui/interview-controller-i18n.test.tsx`
- `apps/web/tests/ui/interview-create-i18n.test.tsx`
- `apps/web/tests/ui/interview-journey-i18n.test.tsx`
- `apps/web/tests/ui/interview-legacy-i18n.test.tsx`
- `apps/web/tests/ui/interview-overlays-i18n.test.tsx`
- `apps/web/tests/ui/interview-secondary-i18n.test.tsx`
- `apps/web/tests/ui/interview-workspace-i18n.test.tsx`
- `docs/design/i18n-interview-journey/plan.md`
