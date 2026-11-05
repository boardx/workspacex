# Chat6252 targeted-policy fixture review

Verdict: **STATIC CLEAN — no actionable P1/P2** in the single-file working delta against exact HEAD `0f7253fa93e9001cd4164e24c7540bbc20449068`.

`git diff --name-only` confirms only `.harness/scripts/ci-targeted-ui.test.ts` differs. Production inspector/helper, policy JSON, configs, workflow and product sources have zero diff. Reviewed working-file SHA256: `8e4a75f083404e0996548fcedeac6e3acb876991bb0c29f7f291268ff9219e24`, mode 0644. This verdict binds that working content, not a future commit.

- Lines 5–8 retain actual Hello→Hi and cn("a")→cn("b") eligible positive examples on the original compliant fixture, now requiring each changed string to differ from its baseline. They no longer derive positives from the live component, whose new imports and calls are outside the deliberately conservative boundary.
- Lines 13–16 explicitly check the actual configured component contains `useI18n` and `localizedTaskTemplates`, then require even its unchanged before/after pair to fail eligibility. The policy sourceFile is `chat-task-workbench-empty-state.tsx`; its actual imports and calls match those checks. The inspector still requires both source trees to be safe; no production eligibility was expanded.
- Lines 77–79 extend the existing temporary Git history fixture with the captured actual component in the configured source path. Its original compliant baseline differs from that real i18n source; the expected result remains full with exact `runtime-or-public-boundary-changed` reason. Existing runtime/public API, ancestry, missing/renamed/nonregular file, dictionary/registry and plan-integrity negatives are preserved.
- Lines 100–105 use an explicit compliant local component before four hostile changes, requiring baseline eligibility and `changed !== component` for each. Every replacement anchor is present once: `return <button`, `"use client"`, `材料 {materialsCount}`, and `bg-card px-2`. The original tagged-template payload is unchanged; the other three mutations retain use-server, nonpresentation data-binding swap and external CSS URL rejection semantics. Thus these negatives now prove an actual boundary-crossing mutation rather than relying on the real component already being unsafe. No payload is evaluated by this test; the helper parses source.

No other assertions, policy decisions, suite timeout or fixture cleanup behavior changed.

## Limits

Read-only git/source review only; no tests, typecheck, lint, build, init, browser, network, service or source writes performed. The reported original CI failure is author-supplied evidence. The three related suites were awaiting a fresh gate at review request time; this static conclusion makes no GREEN, browser, or full CI acceptance claim. No raw traces or private logs were read.
