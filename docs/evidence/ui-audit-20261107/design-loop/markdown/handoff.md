# #6348 修复交接

模型每轮整体覆盖背景与验收；改为保留原背景并合并验收。用户手动 updateProject 仍整体替换。该保护意味着通过聊天不能删除既有验收，需手动编辑。

## 独立提交文件

- `apps/api/src/application/design-workbench/append-project-chat.ts`
- `apps/api/tests/design-workbench/project-lifecycle.test.ts`
- `docs/evidence/ui-audit-20261107/design-loop/markdown/`（仅本问题证据）

## 验证

`pnpm --filter api exec vitest run --config vitest.design-html-unit.config.ts tests/design-workbench/project-lifecycle.test.ts`

62 tests passed；相关 HTML 生成回归共101 passed。

RED 与 GREEN 日志在本目录。真实审计项目由主会话人工复测；未自行提交/推送/创建PR/合并。

## 主会话 review 后返工（以本节覆盖前述完成边界）

新增提交文件：apps/web/lib/design-doc-markdown.ts、apps/web/tests/ui/design-doc-markdown.test.ts。

从真实 createProject 空白路径补测：首轮原始brief独立于模型 writeback 持久化，原始具体要求保存在criteria并进入模型context；后续省略/空summary不清目标，重复summary不重复追加。已有原型且无历史时，不把当前修改伪作首次目标。旧项目导出在目标段保留最早持久化user原文，而非只出现在末尾对话。

4000字上限：保留原始brief，不用追加summary把项目写成无效数据；后续完整请求仍在chat。limit-red.log证明此前会溢出。brief-red.log覆盖首次需求丢失、空串和重复；export-red.log覆盖旧项目导出目标段。更新验证：brief-green.log 107/107（68 lifecycle+39 HTML生成），export-green.log 11/11；interaction/field-green.log中包含该11项。首次具体原文是待验收要求，不声称已验证或用模型捏造标准。
