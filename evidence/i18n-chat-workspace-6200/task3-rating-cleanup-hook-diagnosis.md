# Task3 rating test cleanup diagnosis

This records a unit-test harness failure, not a product import/SDK failure or browser acceptance.

1. `i18n-chat-rating.test.tsx` originally used `beforeEach(() => calls.rate.mockReset())`. `mockReset()` returns the mock function.
2. The first rating test configures that mock to return a pending Promise that is released later by the explicit `finish()` driver.
3. Before the rating UI is localized, its English button assertion fails before that driver runs.
4. The installed `@vitest/runner@2.1.9/dist/index.js` collects beforeEach return values in `callSuiteHook`, then `callCleanupHooks` invokes and awaits every function returned. It therefore invokes the rating mock as teardown and waits for its unreleased Promise.
5. The bounded diagnostic log shows the trace-live, framework-host and suggestion cases actually reaching missing-English assertions, while the rating file does not finish. The command was terminated at the outer18s process-group budget; Vitest's own timeout configuration was unchanged. No complete global test summary or successful command is claimed.
6. The hook now uses a block that returns nothing: `beforeEach(() => { calls.rate.mockReset(); })`. The pending decision, locale/raw-content and exact server-attribution assertions remain unchanged. Rating production code has not been edited before its actual semantic RED.

The earlier partial-SDK/re-export collection hypothesis was an incorrect attribution. The original partial SDK mock has been restored, removing speculative unrelated-renderer isolation, so the next independent bounded rating run can check the identified return-value fix. Causal confirmation and the two expected missing-English rating assertions are still pending a fresh serial resource window.

The earlier corrected `escalation-thread-record` source-order suite independently completed9/9 tests. Its enclosing four-file command later terminated and is not described as a whole-command GREEN. No historical test result, skipped test or terminated run is reused as a pass.


Causal confirmation:after the void-returning hook correction, the independent two-case rating command exited1 normally in3.08s with both English-label assertions failing (`Needs improvement` / `Helpful`), a complete1-file/2-test failure summary and no cleanup hang. The original Vitest timeouts remained unchanged; no outer diagnostic termination occurred. After this actual semantic RED, only owned rating render labels/wrapper copy were localized. Exact request/body, raw reason/error, verdict/submitted/attribution state and busy/disabled handling remain unchanged. Fresh GREEN/type/scopedlint for that production change is pending.


Further confirmation:the original partial SDK mock was restored, and the complete four-file8-case follow-up (suggestion, framework host, rating and live strip) exited0 with8/8PASS6.34s. This includes the two former rating cases and the single/plural action-count counterexample, with no import/cleanup hang. The earlier SDK-cycle attribution is not used. Current57-file scoped ESLint also exited0; this does not replace cumulative type, broader current-source regressions or browser acceptance.
