# 原始需求（细化）— UC-8.10 工具调用轨迹跨 run 回喂上下文

> 所属：阶段一 · 能跑完一场项目 / M8 Chat
> 来源：人类 2026-08-15 要求评估我们的 context engine 与 Codex CLI / Claude Code 的差距，
> 调研结论指出的差距 G-A（跨 run 的工具调用轨迹不进上下文），人类原话「同意 继续执行」。

> 口径（四标记）：本 UC 无 `[原型]`（这是端口内侧的组装逻辑，无独立界面）。行为为
> **[Backlog]**（差距分析 + 人类直接批准）+ **[待设计]**（尚无签核参数）。**本文件不能
> 直接开工**：它修改 `execute-run.ts` 的历史组装逻辑——这是已签 `chat-context-engine`
> 束明确要求"动 execute-run.ts 需取 coord-main 串行窗口"的文件（F154 notes 原话），且
> 引入了 L1/L2/L3 之外的**第四类**上下文来源，超出该束已签参数的字面范围，需要走
> design-delta 追加签核，不能援引 F154/F155/F157 的既有签核直接开工。

## 现状（实测，先讲清楚差距具体在哪，避免重复造轮子）

- `apps/api/src/infrastructure/agent-run/pg-agent-run-repository.ts:519` 的
  `readThreadHistory` **只读 `chat_messages`**，`agent_run_steps` 表完全不参与历史组装。
- `agent_run_steps` 表（`migrations/20260805110000_wave2_agent_run_execution.sql` +
  `20260808130000_i725_tool_calling_loop.sql` + `20260808140000_i731_tool_call_planning_note.sql`）
  **已经**记录了 `tool_call` 类型 step 的真实描述性字段（不是哈希）：
  `tool_name`、`tool_args_summary`（≤1000 字符）、`tool_result_summary`（≤1000 字符）、
  `planning_note`（≤1000 字符）——契约见 `packages/contracts/src/wave2-runtime.ts:276-288`。
  这些数据**已经在采集、已经在持久化**，只是从未被下一轮 run 的历史组装读取过。
- 结果：单次 run 内（远程 `apps/deep-agent-service` LangGraph 的 loop 内）工具调用轨迹是
  该次生成的上下文的一部分；但**跨 run**——比如用户分几轮让 agent 完成一个任务、或者
  同一线程稍后又问起"你刚才查到的那个数字是多少"——下一轮 run 完全看不到上一轮做过的
  工具调用，只能看到 `chat_writeback` 落库的最终文字回复（如果工具调用没有在回复文字里
  逐字复述结果，那条信息对下一轮就是不存在的）。
- 这正是我们与 Codex CLI / Claude Code 最本质的架构差异：那类产品的多轮 agentic loop 里，
  上一步工具调用结果本身就是驱动下一步决策的核心上下文，不是"检索来的"，是"当次生成、
  持续携带"的。我们现在的架构里这部分信息被采集了、但被丢在"审计专用"这个角色里，
  没有回到组装管线。

## R1 概览

- **Use Case ID / 名称**：UC-8.10 / 工具调用轨迹跨 run 回喂上下文
- **Actor**：系统（agent run 组装层，`execute-run.ts` 端口内侧）；间接受益者为对话参与者
  （多轮 agentic 任务里，后续轮次能"记得"前面轮次做过的工具调用）。
- **目标**：让某一轮 run 里发生的工具调用（`tool_call` step 的
  `toolName`/`toolArgsSummary`/`toolResultSummary`/`planningNote`）能够作为一类上下文来源，
  被后续轮次的历史组装看到——不要求逐字复述进最终回复文字，模型也能利用它。
- **本用例结果**：`ModelCallInput.history` 除已有的 L1（近端原文）/ L2（摘要）/ L3（文件
  检索）之外，追加一类"上一轮（或近若干轮）工具调用轨迹"的伪消息来源，仍是 `role+content`
  形态（`ModelCallInput`/`ModelCallPort` 契约不动，同 L1/L2/L3 的既有边界）。
- **系统边界**：`ContextAssemblyPort`（端口内侧）；新读取路径复用既有 `agent_run_steps`
  表（不新建表、不新建列——数据已经在那里）。
- **核心数据对象**：`agent_run_steps` 表中 `kind='tool_call'` 的行，按线程/按最近若干轮筛选。

## R2 前置条件 / 触发条件

- **前置条件**：一次新的 agent run 已 claim，同线程存在至少一次此前 run 记录了
  `tool_call` 类型的 step。
- **触发条件**：`execute-run.ts` 在"history 已取、调 model 之前"的窗口——与 L2/L3 同一个
  组装时点——追加读取该线程近若干轮的 `agent_run_steps`（`kind='tool_call'`）。

## R3 主流程（草案，供 requirement-author 细化，不是最终判据）

1. **系统处理（读取）**：以当前线程为范围，按 run 时间倒序读回近若干轮的 `tool_call`
   step（范围窗口——最近 N 轮 run，还是最近 N 条 tool_call、还是只取"上一轮 run"——留待
   R4 裁定）。
2. **系统处理（组装）**：把读回的 tool_call 摘要（工具名 + 参数摘要 + 结果摘要）拼成一段
   "近期工具调用记录"伪消息，插入 history（插入位置——与 L2/L3 相对顺序如何排——留待 R4
   裁定，但不得排在当前用户输入之后）。
3. **系统响应**：`ModelCallInput.history` 携带这段新的伪消息来源，交给 `ModelCallPort`
   （契约不动）。

## R4 待设计（本文件明确不预先裁定，留给契约签核）

1. **范围窗口**：读"最近 N 轮 run 的 tool_call"还是"最近 N 条 tool_call 记录"还是
   "只读上一次 run"？三者在"用户分十轮慢慢问一件事"这类长任务里的效果不同，不能由实现者
   自行选。
2. **预算与 L1/L2/L3 的相对优先级**：这是第四类要挤进同一个字符预算的信息源，跟 L1（近端
   原文）/ L2（摘要）/ L3（文件检索）合并时，谁优先谁被裁——尤其当 L1 本身就包含了触发
   那次工具调用的用户消息与最终回复文字时，工具轨迹信息可能与 L1 有重叠，需要判断重叠时
   要不要去重、怎么去重。
3. **个人线程是否适用**：F156 delta 刚把"个人对话零跨范围召回"钉死为硬边界（`cross_scope
   _retrieval_requests == 0`），但工具调用轨迹是"本线程自己产生的"，不是跨范围检索——
   本 UC 与 F156 delta 的边界如何共存（大概率不冲突，因为都是"本线程范围内"，但需要在
   签核时明确写一句，不留活口）。
4. **降级/可审计**：工具轨迹回喂是否要在 F157 的 `agent_run_context` 快照里留痕（"这次
   喂了几条工具轨迹、来自哪几次 run"）——如果 F157 已经落地（PR #1318），本 UC 应该直接
   复用它的快照结构追加一个来源类别，而不是另建一套记录方式（同一事实不得声明在两处）。
5. **是否需要新的失败模式**：`agent_run_steps` 读取失败时，是否像 L2 摘要失败那样降级为
   "跳过这一类来源、不阻断 run"，还是别的处理——留待签核。

## R5 依据

差距分析（人类要求的 context engine 对标评估）明确指出的真实架构差距，且底层数据已经在
采集、已经持久化，不需要新的采集机制——这不是重新设计，是把已有的信息接进已有的组装管线。
属 `chat-context-engine` 束，但引入 L1/L2/L3 之外的第四类来源，超出该束已签参数字面范围，
需要 design-delta 追加签核（预计与 `context-engine-l3-file-based` delta 同等重量级，
需要人类直接看，不适合 coord-main 代裁）。
