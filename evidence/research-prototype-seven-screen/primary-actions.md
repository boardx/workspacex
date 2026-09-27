# Primary actions — issue #4468

The production chapter-to-report action now explicitly uses the same primary
variant as intake and plan, rather than the shared Button's secondary default.
The topic fixture's next-step link uses primary as well.

Verified in the Codex in-app browser at 1448 × 1022: topic next action is black;
header switches to chapters; chapter next action navigates to the report fixture.
`chapters-primary-action.png` is the fixed-data visual sample, not a real model run.
Nine production-route/action tests and web typecheck passed. Full prototype
fidelity and remote CI are not claimed complete by this focused correction.
