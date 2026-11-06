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

## 独立 review 返工

修复 caption 丢失与 rowspan/colspan 列错位。caption 输出为可编辑正文；合并范围展开为空的可编辑占位格，后续行文字不会移到错误列。span按浏览器列上限1000并按实际行数界定，避免任意巨大属性分配。

caption-span-red.log：在 /tmp 隔离 fd92b1166 原实现上实际运行 caption/rowspan 反例，两项失败。caption-span-isolated-green.log 为相同 /tmp patch 两项通过。脚本留作 caption-span-isolated-check.ts.txt；原副本 /tmp/pptx-caption-check-20261107/。

live 新增两项测试的首次运行受到并行负载延迟、在实现修改后才收集，因此该输出如实保存为 caption-span-retest.log（不是RED）。正式GREEN：caption-span-green.log 8/8，通过实际PPTX解包验证caption，以及rowspan+colspan字段矩阵断言。git diff --check通过。只改原定两份live文件及本证据目录，未提交。
