# Board 开发交接

## 已验证

第一轮 UI 预览见 ui-review.md 与 ui-preview/browser-verification.md；13项浏览器交互、19项组件/导航测试通过。`./init.sh` 快速路径已通过；不是全仓发布验证。

## 本轮改动

Studio Board → `/studio/board`，共享组件 `components/whiteboard`，开发专用 `/preview/whiteboard`（生产404）。支持本地便签/图形/连线、拖动、批量、文字修改、搜索、撤销/重做、缩放；移动端适应全图和折叠属性。追踪 issue #3902，分支 codex/studio-board-ui。

## 未验证与门槛

当前全部内容仅内存预览，不持久化、不多人同步，不支持Chat图表插入、投票、导出或迁移。十轮需求仍未完成。注册agent身份/协调凭据未提供；正式契约束及人类签核未形成，不冒用身份、不代签、不改passing。

## 下一步

1. 读取 implementation-plan.md 与需求，审阅当前UI。
2. 获得已注册身份和协调凭据路径，按 agent-bootstrap 接入tick；创建/选定phase并将需求迁入单源。
3. 物化第2轮用例/API/domain/coverage材料，完成束级人类签核与一致性复核，再认领后端feature。
4. 复跑：`pnpm --filter web exec vitest run tests/ui/whiteboard-preview.test.tsx tests/ui/nav-ia-two-levels.test.tsx`。
5. 浏览器复跑：`pnpm --filter web dev --port 3317`，随后 `pnpm --filter web exec playwright test --config playwright.whiteboard.config.ts`。预览仅开发态可用。

本轮未起Docker栈。预览服务应在验证完成后关闭。提交/PR与CI状态以实际GitHub信号为准，不能由本文件推断。
