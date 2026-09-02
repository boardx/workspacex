# WorkspaceX 端到端核心流程 · 手工测试清单

面向**不懂技术的测试人员**的 Word 清单：14 个模块、71 条用例，每条都是
「操作步骤 → 预期看到 → 结果打勾 → 备注」，附测试账号表、产品导航地图、
结果汇总表与问题记录表。

- 成品：`workspacex-e2e-manual-test-checklist.docx`
- 生成脚本：`build-checklist.js`（依赖 npm 包 `docx`；内容改这里，不要直接改 docx）

```bash
npm i docx@9            # 任意临时目录
node build-checklist.js docs/testing/manual-e2e-checklist/workspacex-e2e-manual-test-checklist.docx
```

用例锚定的按钮文案与路由来自 `apps/web/lib/navigation.ts`、`apps/web/components/**`
和 `apps/web/e2e/core-journey-*.spec.ts`；界面文案变了要同步改脚本重新生成。
