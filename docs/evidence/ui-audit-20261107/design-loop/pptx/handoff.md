# #6341 修复交接

HTML 分支原先截断成300字单文本框；现在语义表格转换为原生表格，保留完整正文。

## 独立提交文件

- `apps/web/lib/prototype-pptx-export.ts`
- `apps/web/tests/ui/prototype-pptx-export.test.ts`
- `docs/evidence/ui-audit-20261107/design-loop/pptx/`（仅本问题证据）

## 验证

`pnpm --filter web exec vitest run tests/ui/prototype-pptx-export.test.ts`

6 tests passed；解包 XML 验证 a:tbl、单元格和末尾目标。

RED 与 GREEN 日志在本目录。真实审计项目由主会话人工复测；未自行提交/推送/创建PR/合并。
