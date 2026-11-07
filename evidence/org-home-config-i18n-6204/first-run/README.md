# First browser run: assertions passed, screenshot QA found a gap

Exact source98fc15556 passed the original real journey (14.0s case,4m17s including fresh build and1s cleanup). This is not final acceptance: the original test asserted selected-tab state but omitted inactive-panel visibility.

The inspected375px Content and Layout screenshots show inactive Layout/Edit sections still present. Actual source has `hidden={tab !== ...}` alongside the unconditional `flex` utility. Tailwind3.4.19 preflight declares `[hidden]:where(:not([hidden="until-found"])) { display: none; }`, followed by the equal-specificity `.flex` utility. The existing utility wins. The same source shape predates this branch (bfb608070).

Add real browser assertions that inactive panels are hidden, then make only the three panel display classes conditional. Preserve mounted children, form/tab/picker state and every API operation. Re-run a fresh production browser; these first-run screenshots/logs remain counter-evidence, not a final green claim.
