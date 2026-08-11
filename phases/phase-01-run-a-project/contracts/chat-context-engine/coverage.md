# 契约束 `chat-context-engine` — ④ UC 覆盖证明（支撑材料）

> 覆盖 feature：见 `design-signoff.md` 的 `covers:`（**权威**，本文派生）。
> 依据 UC：`08-chat/uc-8-7-上下文引擎分层历史.md` 的 R12 验收线索（V1–V7）。
> ⚠ **本束无对外 HTTP 面**（见 domain.md 第三节，ADR-023 形态 B）——下表「API 操作 / 门控命令」
> 列填的是**端口内侧可执行断言**（均非 HTTP 端点，与「无 HTTP 面」不矛盾）。

## R12 验收线索 ↔ 门控命令（逐条不沉默）

| V | 一句话（uc-8-7 R12） | API 操作 / 门控命令 | feature | 状态 |
|---|---|---|---|---|
| V1 | 打破 20 硬上限：30+ 轮线程第 5 轮的事实经 L2 摘要仍可检出 | `pnpm --filter api exec vitest run tests/chat/layered-history-l2-persist.test.ts` | F154 | ⏳ not_started |
| V2 | L2 增量不重读全史：第二轮摘要只含新增区间，`thread_context_state` 被更新非重建 | `pnpm --filter api exec vitest run tests/chat/layered-history-incremental-not-full-reread.test.ts` | F154 | ⏳ not_started |
| V3 | L3 接线 · 权限约束：项目线程召回一次，传入可见范围==actor 范围，越权片段不出现 | `pnpm --filter api exec vitest run tests/chat/l3-context-pack-wiring.test.ts` + `tests/chat/l3-retrieval-permission-scope.test.ts` | F155 | ⏳ not_started |
| V4 | 个人对话零召回 · 真栈反证：`agent_run_context.retrieval_requests == 0` | `pnpm --filter api exec vitest run tests/chat/personal-thread-zero-retrieval.test.ts` | F156 | ⏳ not_started |
| V5 | 快照可审计：`agent_run_context` 一行含 L1 轮数/L2 覆盖边界/L3 召回条数/token 估值 | `pnpm --filter api exec vitest run tests/chat/agent-run-context-snapshot.test.ts` | F157 | ⏳ not_started |
| V6 | 降级不 fail run：摘要/检索失败退回更简组装、快照记录降级 | 断言并入 `tests/chat/layered-history-l2-persist.test.ts` 的降级用例（F154）+ `l3-context-pack-wiring.test.ts` 的检索失败用例（F155） | F154/F155 | ⏳ not_started |
| V7 | `ModelCallPort` 契约不动：签名/语义未变，组装输出仍为 `ThreadHistoryMessage[]` | 契约层断言（既有 `packages/contracts/src/wave2-runtime.ts` 的 `ModelCallInput` 形状不变 + `tests/agent-runtime` 端口测试） | F154/F155 | ⏳ not_started |

⚠ 命令锚的是 F154–F157 将来创建的 API 层单测（与 feature_list verification 一致），**均非 HTTP 端点**。
③ 件门控：`node .harness/scripts/lint-third-artifact.mjs`（形态 B：domain.md 无 HTTP 声明 + 本表命令列）。
