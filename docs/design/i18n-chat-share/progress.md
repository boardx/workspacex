# Progress — #6176

Four new behavioral tests first failed, then seventeen selected tests passed (4new +8 existing lifecycle/security +5 resources). Targeted ESLint exit0; UI wiring and existing unconditional seeded spec gate pass. First attempted red invocation had worker-pool configuration error and0 tests; corrected min/max worker invocation produced the four actual assertion failures. First wiring command used node against TS imports and did not run; canonical tsx invocation passed.

Production browser running; no current browser pass claim. Source frozen while build/Next runs. PR6175 scanner follow-up was prioritized first and pushed independently; this WIP was restored by exact stash7169710eb5f749c4fee8ba400f48a4b957f5ec8c. No second worktree.

First actual browser attempt failed at the initial language selector before sharing assertions (1 failed test,9m42s including cleanup1s). Screenshot and app/chat/(v2)/layout.tsx confirm chat intentionally hides TopBar; original test assumed a picker there. Corrected journey uses the actual profile picker before entering chat and retains real cross-tab locale changes. Clipboard interaction explicitly brings the owner tab to the front after interacting with the locale tab. Timeout and sharing assertions unchanged. First stackwsx-558fedc96ee123237c84 has0 containers including stopped. Fresh standard production rebuild running; no reuse bypass.

Added anonymous server/malformed/network error masking and no-replay cases; final selected suite20/20 (7new+8existing+5resources), targeted lint0. Source59df0eb57 reviewed without findings; test-only follow-up still needs exact final review.
