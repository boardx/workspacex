# 会话交接 — Sprint 04/06

## 当前已验证
- F06 仍为 `in_progress`，本轮增量已通过报告协议、真实数据库中途恢复、前端流式重连、迁移重放、契约 typecheck 与 lint；尚未经过 PR review/CI/harness passing 门禁。

## 本轮改动
- 报告模型输出改为 NDJSON `meta/section/finding` 事件，每条完整事件先持久化再推送。
- 新增 Bearer 鉴权的生成流与只读观察流；浏览器断开不取消服务端生成，重新进入从 workflow 的 `reportGeneration` 恢复并继续观察。
- 数据库保存 running/failed/completed、requestId、错误码及部分报告；最终事务失败也不会留下永久 running。
- Web 展示已完成的摘要、Markdown 和发现，并在刷新后自动恢复。
- 报告质量门已升级：必须按七个研究章节输出，结合完整 Persona 与逐题原回答，区分原意/归纳/推论，输出共识、分歧、优先级行动与验证计划；结构或来源覆盖不足时不允许完成。

## 仍损坏或未验证
- `pnpm harness tick` 因环境未配置 `COORD_GATEWAY_URL` 无法执行。
- 全仓 typecheck 有本次修改前已存在的 `@repo/dev-mode-accounts` 与 canvas/fabric-markdown 依赖错误；本次 contracts typecheck 已通过，目标 API/Web 测试均通过。
- PR #2479（流式生成与恢复）已合入 main；PR #2489（专业报告质量升级）等待 CI 与独立 reviewer；不得提前把 F06 标为 passing。

## 下一步最佳动作
- 继续 issue #2488 / PR #2489：review 按 exact SHA 验证后再进入 harness 门禁。不要手改 `active-features.json` 或把 F06 直接改成 passing。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 04/06`
- 调试:`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/itv/digital-interview-langgraph-persistence.test.ts -t 'persists streamed report sections' --testTimeout=30000`
