# 本地版 chat「健壮性 + 本地↔在线差异」十轮迭代

人类指令（2026-09-22 夜）：一晚十轮，每轮实现→验证→评估→据评估找出下一轮 10 个候选；
交付一个效率与质量都更高的 chat；要结合 local workspace，用户能从本地切到正式系统，
界面要有明显变化，本地与在线的功能可以不一样。

## 分工（与并行会话协商结果）
机器上另有一个会话（「本地工作区端到端验证」）在跑 #3749 的**效率**线（提示裁剪 / 模型
预热 / 模型路由 / 评测 lane），主 checkout 归它。本文件记录的是**另一条线**：
故障纪律与健壮性、本地 vs 在线的版次差异。工作树 `/Users/shenyanbin/Documents/wsx-wt/chat10`，
分支 `worker/claude-3749-chat-quality-local-mode`，基线 `16b7fe4ae`。

## 取证起点（不是推测）
用户那台机器的安装版日志 `~/Library/Application Support/WorkspaceX/local/logs/api.log`：
- `agent run model call failed` 共 **2** 条，**两条都是** `skill_activity_delivery_unavailable`
  —— 也就是说这台机器上迄今每一次 chat 硬失败，原因都不是模型、不是工具，而是一条
  **展示/溯源事实**没投递到。
- `error log summarization timed out` 数十条：一个 best-effort 的后台 AI 摘要任务在本地
  反复用 4B 模型超时，与用户正在等的 chat 抢同一块显存与队列。

## 轮次记录

### R1 —— 版次骨架 + 溯源投递不再拿整条 run 抵押（完成）
做了什么
1. 新契约 `packages/contracts/src/deployment.ts`：版次枚举、环境变量名、解析（默认 `cloud`，
   安全方向）、**故障纪律**（`skillActivityDeliveryDiscipline`）、**能力差异矩阵**
   （9 条，带逐条原因）。这是本地↔在线一切差异的单一事实源。
2. `deep-agent-model-provider.ts`：新增 `SkillActivityDeliveryError`（与工具事件投递失败
   分开类型，两者纪律不同），三个 fail-closed 点在 `best-effort` 下改为「记一条缺页 + 落回轮询」。
   云端逐字节不变。
3. 新账本事件 `skill_activity_gap`（不是塞进 `SkillActivityFact`——那是严格的公共溯源形状）；
   `createSkillActivityGapWriter` 写它，写失败只 log。前端 `run-trace.ts` 单独渲染它，
   不再掉进 `tool_end` 那个读 `event.ok` 的分支。
4. `local-runtime` 给 API 传 `WORKSPACEX_EDITION=local`；字面量与契约的一致性由
   `packages/local-runtime/test/deployment-edition-env.test.ts` 机械核对。
5. 前端版次下发：`app/layout.tsx` 服务端读一次 → `<html data-edition>` + `EditionProvider`
   （不用 `NEXT_PUBLIC_*`：那会在 `next build` 时内联，换成预构建启动就静默失效）。
6. `EditionBanner`：本地版常驻、**全断点**标识条 + 「与在线版有 N 项能力不同」展开清单，
   原因逐字取自契约。在线版不渲染任何东西。

验证（每条都附反证）
- `packages/contracts/tests/deployment.test.ts` 6 passed。
- `apps/api/tests/agent-runtime/local-skill-activity-best-effort.test.ts` 6 passed，
  与既有 fail-closed 测试 `workbench-skill-activity.test.ts` 10 passed 同时绿。
- **反证①**：把 `skillActivityDeliveryDiscipline` 改成恒 `fail-closed` ⇒ 新测试 5/6 红
  （只剩「云端不变」那条绿）。
- **反证②**：删掉 `run-trace.ts` 里 `skill_activity_gap` 分支 ⇒ 缺页被渲染成 `kind: "tool"`
  （真实联合里 `ok: undefined` ⇒ 失败行），前端两条测试全红。
- `apps/web/tests/ui/edition-banner.test.tsx` 3 passed；`lint-design.sh` 全过；
  contracts / api / web 三处 `tsc --noEmit` 干净。

### R2–R10
见下方「下一轮候选」，每轮结束追加。
