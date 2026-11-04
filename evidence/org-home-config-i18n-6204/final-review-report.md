# Whole-branch final source review — #6204

Base: `bfb608070b6ebb77156e63fde2d7f6b7c97101a6`.
Head: `98fc15556f2a810f9630fee56c0c58b5ccd79b65`.

**Verdict: CLEAN for the exact source range; no actionable P1/P2 findings. Not yet ready for merge on this review alone.**

Reviewed the design and plan, SDD progress and implementation/task-review reports, generated final-review package, exact three-commit diff, new seventeen-case component suite, and entire new browser journey. Cross-checked the affected source against live client wrappers, strict home-config/org-admin/agent-directory contracts, upload controller, recommendation clamping/filtering, and actual starter-pack import behavior. This review followed the requesting-code-review reviewer template. Only this report was written; no source/index/HEAD/branch changes or executions of tests, lint, typechecking, init, database, Next, browser, push, or subagents.

## Strengths

- The eleven production files localize controlled copy while retaining canonical IDs, routes, order, icon/style metadata, authorization checks, normalization, null conversion, recommendation bounds, raw authored fields and snapshots. Twenty action entries move unchanged in both languages; eight banner labels and six theme defaults reference the import-free namespace. No second metadata fact table or runtime dependency cycle was introduced.
- Locale remains absent from fetch dependencies and component keys. Raw errors, lazy locale feedback functions with wrapped React setters, and a retained submitted-invalid form snapshot permit retranslation without restarting requests or replacing draft state. Validator guards, ordering, return shape, default Chinese, and submitted-error timing are retained.
- Tests exercise actual components and HomeView rather than replacing the localized UI. They cover retained requests, pending upload/logo/catalog state, raw File references, authored values, selected tab/open picker, snapshots/notes, permission denial, saved/error feedback, and inert preview. Existing regression tests additionally cover clamping and disabled-skill exclusion; the stable adapter value `已启用` correctly remains untranslated.
- The browser journey uses real installation APIs and the existing private tenant rather than seeded configuration/results. Contract-derived routes and strict response parses are sound. The update body correctly omits `orgId`, matching `updateHomeConfig`; Zod `.omit()` retains the strict schema. Logo PATCH retains its required `orgId` and artifact ID. File retrieval compares actual bytes, and member GET/PUT assertions check both status and unchanged saved configuration after denial.
- Preview status targets the existing `home-config-preview-status` element, and member denial matches the actual localized message. Geometry checks are scoped to `/org-admin/home-config` and the selected visible tab; no product DOM was changed to satisfy these locators.

## Issues

Critical: none found.

Important (P1/P2): none found.

No minor findings are being parked for later.

## Evidence limits and remaining gates

Root reports seventeen semantic RED failures before implementation, seventeen GREEN cases, 68 passing broader regression cases across five files, source/type/ESLint checks and byte-identical canonical metadata. These executions are root-owned; this reviewer did not rerun them. The browser spec's passing collection/type/lint checks are not evidence that the browser journey passed.

At dispatch, the fresh production browser run for this head had only started. Accordingly, actual API/PostgreSQL/browser completion, screenshot readability, runtime request counts, upload bytes, and permission outcomes remain unproven by this report. The authored browser checks geometry at **375 and 1280**; **820 is a preview screenshot only**, not a geometry assertion (entity-localization.spec.ts:596). Report the evidence at precisely that granularity. The rejection branch asserts unsuccessful HTTP plus canonical unsupported-image feedback; do not describe the test itself as asserting an exact 415 status.

The branch is explicitly stacked on pending profile PR #6203/base `bfb608070…`. Actual profile merge, fresh develop integration, proof of a pure home-configuration delta, source-head and native-candidate CI, and normal PR delivery remain required. This review does not certify runtime success, a clean independent PR base, CI, or merge.

## Declined to judge

- Palette algorithm quality and existing color-generation behavior: deliberately outside this localization plan; the algorithms and authorized API sequence are unchanged.
- Existing banner-upload closure behavior when the user edits other fields while an upload is pending: unchanged by this branch; the new locale tests do not establish concurrent-edit preservation beyond locale switching. This is not treated as a newly introduced regression.
- Existing code-point clamping versus contract string-length semantics for supplementary Unicode characters: unchanged implementation and contract; this branch preserves the existing behavior rather than redesigning snapshot limits.
- Native OS IME composition across locale switching: source identity is preserved, but the added tests do not execute native composition. No runtime IME guarantee is inferred.
- Actual narrow-width readability, including long runtime catalog names, and complete keyboard/pointer inertness: source assertions are reasonable, but the pending real browser execution and screenshot inspection must supply that evidence.
- Main/develop integration and CI readiness: separate live delivery gates, not established by an exact source review of this local stack.

## Assessment

**Ready to merge? No — pending independent runtime and integration gates, not a requested source fix.**

The reviewed source implements the bounded localization plan without an identified P1/P2 defect. Complete the already-planned real browser evidence and independent-base/CI gates before treating the feature as delivered; any subsequent source changes require review of their new exact SHA.
