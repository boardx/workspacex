# Chat6252 source-guard test-only delta

Baseline HEAD: 9e26dab92dfc3ab4fc821b70b75e42df1dafc967.
Working test: apps/web/tests/chat/run-progress-butterfly.test.tsx
SHA256: 35fba46645bed4529ed55cd4bf63bf56f666da8bce19c2eb3a8f8b080094011c; mode 0o644.

Verdict: STATIC CLEAN for this single-file maintenance change. No confirmed actionable P1/P2, deleted/weakened original constraint, wrong target or extra product change found.

- Actual apps/packages diff contains only this test. Product/view/controller remain frozen at baseline; no locale, timeout, retries, fixtures, hook or UI implementation change.
- Old assertion required the accessible sr-only running status span in panelBody text. Actual extracted presentation is in copilotkit-v2-panel-view.tsx:356, with the complete original className/role/testid substring. New file read targets that exact file.
- Original body negative guards (no RunProgressCard / no thinking-stage) remain; original useCopilotKitV2RunProgress(agent,agent.isRunning) ownership assertion remains in body.
- New body assertions verify its actual named import and direct JSX delegate <CopilotKitV2PanelView {...useCopilotKitV2PanelController(props)} />. Independently read actual baseline import and return: exact match, not a similarly named or unmounted helper.
- The three presentation constraints are now also asserted on the actual view: no duplicate RunProgressCard, no thinking-stage, retained sr-only status marker. The former positive body-marker assertion is relocated to its real renderer, not removed or replaced with a weaker generic string.
- Existing independent RunProgressCard DOM/ARIA/stage/elapsed/longrun/plan-step assertions and legacy screenshot harness <RunProgressCard constraint are unchanged. Their intentional legacy component does not imply the canonical panel renders it.
- Provided CI failure provenance (run41915806823 / attempt1 / web shard4 / job126875862957) is parent-supplied; no network/artifact fetch was performed here. Fresh affected/neighbor execution remains pending; static review is not GREEN.

No tests/type/lint/init/build/browser/network/raw logs or source/Git mutations. Only exact source reads, test diff inspection and this private report write.
