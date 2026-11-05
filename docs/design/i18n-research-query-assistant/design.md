# Research query assistant localization — #6253

Owner FIRST; parent #6133. Continue the user-authorized fixed-UI internationalization in the existing checkout, after survey PR6251 actually merged as5832cdb62c08fe4f8917776760626d71c74fea11. Baseline is that delivered develop commit.

The production-accepted `/research?flow=brief` entry renders BriefScreen → ResearchIntake's renderAssistant override → GuidedResearchSkillAssistant. Its fixed heading, help, quick-action labels, errors, suggestion/apply/undo controls, composer and model provenance remain Chinese. The ordinary `/research/new` assistant and shared step layout are already localized.

Use the existing shared provider and research namespace. Reuse exact existing Chinese keys; add narrowly scoped pairs for remaining helper copy. Keep every original quick-action Chinese message as its canonical outbound/stored intent and translate only its display label. This follows the existing render-time localization architecture and needs no additional locale state, request wrapper or component replacement.

Preserve user/model text, modelId, progress n/5, snapshots, local history/storage keys and unknown data. Locale changes must retain the input DOM/focus/selection, pending request/proposal and explicit application/undo. Preserve send/requestId, sessionKey/step effect dependencies and all API/contracts/model behavior. No layout redesign, preview-route delivery claim, API/ASR/parser/encoding changes or6239 work. The four other step variants receive supported display labels and unit coverage; the proven live claim remains the query brief entry.

Verification is defined in issue6253 before implementation: a focused semantic RED/GREEN suite, existing assistant/state/entry/overlay regressions and resource parity, scoped lint/webtype, and a new query case in the existing registered research E2E file. Preserve the original case byte-for-byte and existing runner budgets. Real375/1280 captures and actual request/payload identity must pass before READY. Controlled API/model fixtures do not establish vendor quality or PostgreSQL behavior. Existing local Next-build prohibition remains; use existing remote CI.

One PR Closes6253; original reviewer checks the bounded source/evidence; coordinator alone merges. Per coordinator instruction, this next i18n batch also records the five previously published/hash-bound final B6 safe receipts and actual-merge documentation without changing historical results. Their source remains65e5fe99d93792f2b19831cbfac7e37f46b5f42c and run41933129696.
