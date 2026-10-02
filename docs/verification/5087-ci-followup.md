CI follow-up for PR #5087, base head 8a40e6bf67a8b4a70537de836ffa14bad514c999.

The full web CI suite passed 835 files / 7001 tests with one stale transition regression failing at guided-research-step-transitions.test.tsx:175. Its mock returned outline and expected /plan after chapter save; #5081 introduces save_chapters which preserves research and stays at /chapters. Local RED reproduction: 12 passed, 1 failed.

Updated only that fixture and regression: dedicated save_chapters command, edited section id/title in payload, returned chapter title, /chapters route and chapters workspace, absence of plan panel. Product code unchanged. Existing dedicated chapter-save API/source/task preservation tests remain unchanged.

GREEN: guided-research-live and guided-research-step-transitions, 2 files / 30 tests passed, exit 0. Affected ESLint and git diff --check passed. New-head CI remains required. Fullstack also needs the separate shared Board placement fix #5096.
