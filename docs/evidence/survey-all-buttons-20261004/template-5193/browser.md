# Report template unbinding real-browser evidence

Web source `b4bc0aba7663113c9c585064f7f6b8e5e9cdce73` on25706, API source814 on24704. API-related Survey/kernel/contracts bytes equal b4bc baseline; see api-version-compatibility.md. This is not a whole-app same-SHA claim. Only synthetic data, CUA UI actions; no API answer seeding or library deletion.

Sample: ae22d556-ba5a-45c3-bd67-05f06431481a,21questions from builtin团队协作健康度调查 plus multiline. Same original main sample retained for counterproof.

1. Before clear, design says“报告章节尚未覆盖对应题目 多行文本”; template7sections and generic configuration warning. New“ 不使用报告模板 ”button is enabled despite issue (`bound-error.png`).
2. Click clear: report0sections, report title becomes survey title, immediate“设计检查通过”; generic warning gone, template-only undo visible.
3. Click undo:7sections and original coverage issue restored (`undo-restored.png`).
4. Clear again, await actual“已保存” without clicking Save, reload:0sections, no unbind/undo button, no generic warning, check passes (`cleared-after-reload.png`). Saved03:17:29 Asia/Shanghai2026-10-04.
5. Return to design:21questions still present, automatic check passes (`questions-preserved.png`). This proves question count/content visible; tag metadata, published snapshot and old report are not independently browser-tested by this sample and remain separately regression-covered.
6. Return list, open builtin source团队协作健康度调查: actual“共20题”; report configuration仍7sections and original report title/blocks (`source-template-preserved.png`). Source was not modified. A wait incorrectly reused list-card wording on editor page; fresh DOM showed actual“共20题”, not a product failure.

Supplementary, not PASS: opened use-report dialog, selected team-health template, assigned20visible compatible same-title mappings. Apply enabled; clicking Apply timed out at Input.dispatchMouseEvent, getJsDialog returned undefined, fresh DOM and documented tab.pressKey(Return) then timed out at Emulation focus. No native-app bypass, no assumed confirmation/application success. Final current-tab supplemental replace outcome remains TOOL_BLOCKED. Core unbind/undo/save-refresh above was verified before this modal. New-template/edited-title undo invalidation and published preservation still need separate real UI rows; passing unit tests are not counted as those browser cases.

Global558case inventory remains incomplete. No historicalPASS migration, no merge/deployment.
