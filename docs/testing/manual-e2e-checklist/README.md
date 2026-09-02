# WorkspaceX 端到端核心流程 · 手工测试清单

面向**不懂技术的测试人员**的清单：14 个模块、71 条用例，每条都是
「操作步骤 → 预期看到 → 结果打勾 → 备注」，附测试账号表、产品导航地图、
结果汇总表与问题记录表。

- **推荐发放：`workspacex-e2e-manual-test-checklist.pdf`**（Chromium 排版，打印/手机阅读效果稳定）
- 备用：`workspacex-e2e-manual-test-checklist.docx`（需要在 Word 里改内容时用）
- 内容唯一来源：`content.js`（用例、账号、地址都在这里改，不要直接改 pdf/docx）
- 生成脚本：`build-pdf.js`（HTML + playwright-core + Chromium）、`build-checklist.js`（docx）

```bash
# 任意临时目录
npm i docx@9 playwright-core@1.5
node build-pdf.js       workspacex-e2e-manual-test-checklist.pdf    # 默认用 /opt/pw-browsers 里的 Chromium，可用 CHROME_PATH 覆盖
node build-checklist.js workspacex-e2e-manual-test-checklist.docx
```

用例锚定的按钮文案与路由来自 `apps/web/lib/navigation.ts`、`apps/web/components/**`
和 `apps/web/e2e/core-journey-*.spec.ts`；界面文案变了要同步改 `content.js` 重新生成。
