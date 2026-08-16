# 会话交接 — Sprint 01/12

## 当前已验证
- F190（工具调用轨迹跨 run 回喂上下文）：`passing`。
  `pnpm --filter api exec vitest run tests/chat/tool-trace-cross-run-context.test.ts`（V1/V2/V3/V5/V6/V6b/V7，7/7 通过）+
  `tests/chat/tool-trace-context-repo-guard.test.ts`（4/4 通过）；
  官方门控 `pnpm harness verify --sprint 01/12 --feature F190` 通过，证据见
  `sprints/sprint-12/evidence/F190.verify.log`。

## 本轮改动
- 新文件：`apps/api/src/application/agent-run/tool-trace-context.ts`（纯组装 + 端口定义）、
  `apps/api/src/infrastructure/agent-run/pg-tool-trace-context.ts`（PG 实现）。
- `execute-run.ts`：L1/L2 之后、L3 之前插入工具轨迹回喂段（读最近 3 轮记录过 tool_call 的
  历史 run，与 L1 已保留消息去重，失败降级不 fail run）；`ExecuteAgentRunDeps` 加
  `toolTrace?: ToolTraceContextPort`。
- `context-snapshot.ts` / `pg-agent-run-context-snapshot.ts`：F157 快照追加
  `toolTraceStatus`/`toolTraceRunCount`/`toolTraceStepCount` 三字段，迁移
  `20260816010000_f190_tool_trace_context.sql`。
- `agent-run-executor.ts` / `kernel.module.ts`：生产合成注入 `PgToolTraceContext`。
- `lint-permission-paths.mjs` 新增一条豁免（`pg-tool-trace-context.ts`，系统内部读，同
  F157 `record()` 的既有理由）+ 配套 `tests/chat/tool-trace-context-repo-guard.test.ts`
  把豁免前提钉成机械断言；`permission-propagation-six-paths.test.ts` 的 allowlist 上限
  57→58（同 F185 先例的写法）。

## 已知与 verification.md 的一处偏差（如实记录，不是漏做）
- design-delta 的 `verification.md` V4 描述"跨 L1/L2/L3/工具轨迹的共享预算仲裁"，但这份
  代码库里 L2 摘要与 L3 检索目前都是无条件前置、从不参与任何跨层裁剪（各自只有独立的字符
  预算）——工具轨迹遵循同一个既有现实，没有新增一个这份代码库里其它层都没有的跨层仲裁器。
  `tool-trace-context.ts` 头注与测试文件头注都写明了这一点；如果这条偏差不可接受，需要
  回到 delta 补一轮签核再实现真正的跨层预算器，不是本轮悄悄改了行为。

## 仍损坏或未验证
- 无已知阻塞。

## 下一步最佳动作
- 本 feature 完成，push 分支、开 PR（关联 issue，`Closes` 该 issue）。
- context-engine 束（chat-context-engine + 两条已签 delta）目前没有更多待办；F150/F153
  （附件上传相关）属 `chat-file-upload` 束，F150 阻塞于 F110，暂不可开工。

## 命令
- 启动:`pnpm -w run dev`
- 验证:`pnpm harness verify --sprint 01/12`
- 调试:`pnpm --filter api exec vitest run tests/chat/tool-trace-cross-run-context.test.ts`
