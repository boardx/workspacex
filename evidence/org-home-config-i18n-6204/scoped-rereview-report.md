# Scoped final fix re-review — #6204

Range: `98fc15556f2a810f9630fee56c0c58b5ccd79b65..95bf3f272e04eac0131a7acdeaa5a03a5726dd83`.

**Verdict: ADDRESSED. No actionable P1/P2 finding in this fix or its new assertions.**

This is the single scoped re-review of the observed inactive-panel visibility defect, not a repeat whole-branch review. Read the exact diff, fix-review package, amended scope/design and implementation report, browser RED context, and supplied root validation logs. Only this report was written; no tests, services, browser, source/index/branch changes or subagents were run.

The three wrappers at home-config-screen.tsx:148,154,158 now choose exactly one display utility: `flex` for the selected edit/layout/content tab, `hidden` otherwise. This removes the conflicting unconditional flex declaration responsible for the observed CSS behavior. Native `hidden` attributes remain aligned with the selected tab. The correction does not conditionally render these panels, change keys, replace child components, alter effects, or modify data/API paths. Mounted panel-local state is retained when switching among edit/layout/content. The pre-existing separate preview rendering branch is unchanged.

The six new browser assertions check both inactive groups for each of edit/content/layout. They inspect actual rendered visibility at the relevant points in the existing real journey, rather than inspecting only attributes or utility classes. Active sections are also exercised by the unchanged filling, picker, checkbox and screenshot operations. The retained RED shows the initial edit-tab assertion failing with expected hidden / received visible at entity-localization.spec.ts:488, so these assertions discriminate the observed defect.

Evidence read:

- `/tmp/org-home-config-6204-visibility-green.log`: 36/36 component cases in two files, 6.20 seconds.
- `/tmp/org-home-config-6204-visibility-eslint.log` and `visibility-typecheck.log`: no diagnostics; root records successful exit codes. The typecheck log shows `tsc --noEmit`.
- `/tmp/org-home-config-6204-browser-final.log`: registered real journey passes 1/1 in 13.8 seconds, approximately four minutes including production startup, with one-second cleanup. This is supplied root execution evidence, not an independent reviewer execution.

The source delta and supplied RED/GREEN evidence address the specific visibility defect without identified new breakage. The original source-review CLEAN verdict remains historical and did not establish visual correctness; the new visibility assertions close that particular evidence gap.

Declined to judge:

- Final screenshot readability beyond the asserted visibility/geometry: root's separate visual QA is pending; no images were independently inspected in this scoped review.
- Native IME, complete pointer inertness, 820-width geometry and exact 415 HTTP assertion: unchanged coverage boundaries; 820 remains screenshot-only and no broader guarantees are inferred.
- Profile PR #6203 merge, fresh develop integration/pure home delta, source/native-candidate CI and publication: separate live delivery gates outside this scoped source re-review.

**Ready for the next delivery gate: yes. Ready to claim merged or fully delivered: not established here.**
