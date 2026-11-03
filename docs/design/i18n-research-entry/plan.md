# Complete Research Journey Internationalization Plan

> For agentic workers: execute inline task-by-task using the existing checkout. No additional worktree. Do not spawn additional workers for this owned slice.

Goal: usable English and Chinese research list → intake → plan → source/chapter → report/export/history journey with unchanged content and request semantics.
Architecture: typed existing namespace lookup at rendering boundaries; state continues to hold user data, stable status codes and operation identities.
Tech stack: existing React/Next, TypeScript, useI18n, Vitest and Playwright.
Spec: design.md and GitHub issue6198.

## Global constraints

- Fetch main/develop before new development; base44aeac6e10b688471fe03536fc8490a353824976. Preserve6193 stash66bb358d4a941ae294699ff5d232355b300db0f7 and6182 commit16b3f95cb9881c4ed606ea7b6a0d91d5f0d39743.
- One issue/PR, explicit develop target, main is sole native queue operator. No API/model prompt/enum/private content translation.
- Source resources join aggregator ends; preserve prior namespaces. Shared ownership coordinated with phase2/admin worker.
- Serialize init/RED/tsc/browser/normalpush with phase2 and phase3; light implementation may proceed in another owner's heavy window.

## Review focus

- Locale changes while requests are pending must not replay or invalidate idempotency identity.
- Raw braces/Chinese/private names and tags must not become templates or be translated.
- Metadata/tag drafts and IME composition survive provider rerenders.
- Failure and loading copy updates without retaining an old translated snapshot.
- Mobile English actions, discard dialog and assistant remain reachable and focus-safe.

## Tasks

- [x] Read domain skills and audit actual route tree; establish shared ownership and issue6198.
- [x] Write apps/web/tests/ui/research-entry-i18n.test.tsx counterexamples before product implementation.
- [x] Standard init quick exit0; nine entry tests collected/executed RED in4.99s; preserve logs.
- [x] Add research-entry namespace; reuse common keys for shared controls and append resource aggregators. Localize only actual ResearchHome section of guided-research-flow, home presentation, intake/assistant, shell/loading and voice entry UI. Keep canonical step arrays/API defaults unchanged.
- [x] Localize shared studio-history-management/tag-input without changing props, limits, IME, commitDraft or callbacks. Keep notices semantic until rendering.
- [ ] Execute six workspace counterexamples RED before workspace implementation; cover topic autosave, plan confirmation, report/history, PDF identity, authorization retry and raw source links.
- [ ] Localize all actual workspace descendants, semantic request errors, assistant/proposal/markdown overlays, generation timeline/recovery, report/export/history and chapter controls. Keep canonical Markdown/parser/framing and generated/private text unchanged.
- [ ] Pass nine new tests and relevant existing research/home/routes/loading/history/tag/voice suites; run targeted lint/typecheck and resource parity.
- [ ] Add CI-reachable seeded complete research browser journey; discover exact selected case count before starting the isolated stack. Verify language switching preserves drafts/requests, persisted raw content and mobile/desktop controls; inspect screenshots.
- [ ] Independently review exact commit; normal push; create PR Closes6198 to develop; follow fresh source and actual candidate gates until merged.
- [ ] Update coverage matrix and continue B5 plan/report, interview and recording in independent slices. Report B6/B7/B9 gaps to main rather than crossing ownership.

## Scope update — 2026-11-04

Latest user/main instruction expands this PR to the complete actual research journey, including plan editing/confirmation, sources/chapters/report, export/history/regeneration and overlays. The nine initial entry RED tests remain the first test cycle, not proof of whole-domain coverage. Four workspace counterexamples are also written: canonical focus values while labels translate; plan draft/confirmation; raw report/history with no execution replay; exact pending report-file identity/error translation. Run their RED cycle before workspace implementation and add real end-to-end acceptance. Subsequent full interview, recording and B6 survey journeys continue in separate PRs without waiting for new authorization. Preserve raw content and canonical markdown/protocol/model input.
