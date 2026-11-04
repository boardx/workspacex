# Final-wave scoped SOURCE review — #6212

**CLEAN — no actionable P1/P2 finding in this test-only expansion. Runtime acceptance remains pending.**

Scope: only `apps/web/e2e/entity-localization.spec.ts`, exact `0084ad8426a3d87c68a1d006d0a914d78f2b3705` → `65c0b38334bf665230afab6ba205aef5701c34d6` (64 added / 2 removed lines), plus the final-wave authored report and current browser-plan evidence. Current merged HEAD `4f81b76e6` retains this case body exactly, as independently established by the prior merge-increment review. The parent home-config case and unchanged product implementation are not re-reviewed here.

This source seat precedes the first quota browser run under main's latest explicit sequencing instruction. It is the previously planned final-wave scoped source review, not a second whole-branch audit or a waiver of runtime acceptance.

## Source findings

- Invitation coverage is explicitly a draft/cancel journey: a unique authored email including braces is retained across real helper-tab language changes; the dialog stays open, cancellation closes it, the one-time link is absent and observed organization-prefix counters remain unchanged. It does not claim successful invite creation, delivery or activation.
- Budget and rule-edit additions retain the existing numeric drafts, canonical mutation bodies and later persistence assertions. Budget Save and Cancel and rule-edit Save gain full-viewport checks before their captures. No original mutation/error/permission assertion is weakened.
- Initial summary and calls response waits are registered before entering Usage. They match real GET paths, assert HTTP 200, parse actual response bodies with canonical schemas, and compare the calls snapshot and request `asOf` with the initial summary snapshot. This strengthens the prior DOM-only readiness boundary.
- Monthly grain and Calls metric are selected explicitly and their `aria-pressed` states are asserted after the helper-tab locale cycle. The test checks the actual raw-model ledger row's native details disclosure remains open and retains provider/model/CNY presentation across locale changes.
- Model filtering uses the rendered dropdown and exact raw provider/model label. Filtered waits are registered before selection and match both decoded raw query fields plus exact paths. Nonempty filtered calls and every returned call's provider/model are checked, preventing a vacuous empty-array pass. Both response bodies and both request queries preserve the original snapshot. Subsequent locale changes retain selected filter text, Call details tab and loaded raw-model ledger without observed organization-prefix requests.
- The only two replaced old lines expand readiness/ledger assertions; existing unfiltered native-millisecond, unknown-usage and CNY/USD checks remain. No route interception, mocks, forced clicks, retry change, timeout change, product change or fixture change is introduced by this delta.
- Source capture count is **17**: the previous 12 plus invite draft, budget draft, rule-edit draft and filtered-ledger desktop/mobile. New captures use the existing 375/1280 document-overflow helper. These authored calls are not generated or inspected screenshots.

One focused outside-diff read checked the concrete dropdown-selector risk: `apps/web/components/ui/select.tsx` renders the test ID on the trigger, displays the selected label without additional text, and uses `DropdownMenuRadioItem` for option labels. The new trigger/text and radio-item selection match that component structure. No other outside-diff product read was necessary; earlier product and merge findings were not re-audited.

## Limits that remain mandatory

- **Real browser/API/PG execution is unrun.** HTTP matching, schema parsing, snapshot equality, fixture row uniqueness, response timing, cross-tab propagation and persisted mutations still need to succeed on the actual merged-source lane.
- **All 17 final screenshot QA checks are unrun.** Document overflow and selected button viewport assertions do not establish readable labels, unclipped tabs, nested table scrolling, focus usability or complete action reachability. Inspect actual final screenshots and exercise the relevant controls before accepting geometry.
- Counters cover only the observed organization URL prefix; this is not global zero-network proof or coverage of personal/access-log endpoints. Cursor/self-scope remain unit-only, and the test does not establish model execution, financial settlement or funds provenance.
- Root reports merged WebType exit 0 / 36.76 seconds; this reviewer did not run it. Remaining merged-source affected unit/static checks must be assessed from their actual results. No runtime/CI/feature-passing/develop-delivery or merge approval is issued here.

Read the exact scoped diff and both evidence documents. No tests, typecheck, lint, build, services, browser, database, CI, Git mutation, source edits or subagents were run. Only this report was written. Following actual runtime, the planned verification-only evidence follow-up remains required; any runtime-driven source fix requires its own exact scoped re-review.
