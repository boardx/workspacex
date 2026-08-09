# PROP-CHAT-COPILOTKIT-LANGGRAPH-001 — 「CopilotKit + LangGraph deep agent 作为全部 chat 方案」提案

> 状态：**待 coord-architecture / coord-main 评审，未执行**。
> 发起：人类 2026-08-09 直接指示（原话见下），本 agent 判断该指示与同日已有的正式裁决
> 冲突，按 AGENTS.md「契约先行 / 设计签核」硬约束不自行执行，转为本提案。

## 人类原话

> 「CopilotKit + LangGraph deep agent，使用这个组合作为全部的 chat 的方案，你要制定一个
> 验收标准，不论工作量有多大，你都要迎难而上……根据 chat-ux-acceptance-criteria.md，
> 建立一个系统的验收标准而且，你要有一个 role 是来做验收的，有质量的维度，必须要达到
> 十分……在这个过程不要问人类任何问题，你可以根据最佳实践来快速地做决策。」

## 为什么没有直接执行——与同一天已有的正式裁决冲突

`7033e798`（2026-08-08，#684）逐字记录了人类在 issue #654 里已经做过的裁决：

> 「CopilotKit/AG-UI **UI 协议**范围从 P4 扩大到通用 chat，但 **LangGraph 多步编排仍限 P4**」

即：UI 层（消息渲染、Markdown、气泡样式）用 CopilotKit 的组件已经是**已裁决、已执行**的
现状（`@copilotkit/react-ui` 的 `Markdown` 组件已在 `chat-live-message-panel.tsx` 使用，
`POST /copilotkit/agui` SSE 桥接端点已存在）。但**编排层**（谁来跑多步 agent 循环、
工具调用序列、状态机）——这正是「LangGraph deep agent」要接管的那一层——**同一天的正式
裁决明确把它限定在 P4，没有扩到「全部 chat 方案」**。

本次新指示字面上要求「使用这个组合作为**全部**的 chat 方案」，即把编排层的范围从 P4
扩大到全量替换现有后端。这与当天稍早的正式裁决**直接冲突**。

## 为什么不自行仲裁、不自行执行

1. **AGENTS.md 硬约束**：「设计签核（三件、一处签）」——契约级/架构级变更必须走
   `design-signoff.md`，agent 不得自行改判据或自行仲裁两个人类指示哪个更新。
2. **不可逆 + 影响面覆盖全队正在跑的工作**。此刻至少 4 条并行会话正在**现有架构**
   （`AgentRun`/`wave2Runtime`/`PgChatRepository`）上做真实交付，且都已合并或即将合并：
   - #729（composer 麦克风按钮，服务端代理 ASR）
   - #731/#732（工具调用循环后端 + 前端渲染，本会话刚 cherry-pick 进 #728）
   - #699-#703（SSE 流式渲染四阶段）
   - #762（刚合并：移除 ambient-bar 全局假数据，理由之一正是「thread-scoped 的
     `chat-transcript-*` 卡已经用现有架构实现了」——见下方“已有能力清点”）
   全量替换编排层会让这些交付物的落点（`GET /agent-runs/:runId` 的 `steps` 字段、
   `expandToolCallChain`、`chat_wave2_fixture` schema）全部作废，是「悄悄让全队白做」。
3. **本条不是「问人类问题」，是不把一个会毁掉四条并行交付的决定当场私自拍板**——
   这两者不是一回事：拍板是我不该做的事，把决定权交给正确的角色（coord-architecture /
   coord-main）并继续手头已授权的工作，是我该做的事。

## 已有能力清点（供评审参考，避免重新发明）

现状不是「零基础」，很多人以为要新建的东西已经存在：

| 能力 | 现状 | 位置 |
|---|---|---|
| CopilotKit UI 渲染 | 已用（Markdown、消息气泡） | `chat-live-message-panel.tsx` |
| AG-UI SSE 桥接 | 已有真实端点 | `apps/api/.../copilotkit-agui.controller.ts`、`agui-bridge.ts` |
| AG-UI 结构化事件适配 | 已有通用插件层 | `#742 completeWithProgress` |
| 工具调用可见性（对标验收标准第 2/3 项） | 已实现并本会话刚接入 #728 | `AgentRunToolCallSteps`（#732） |
| 多步能力（对标验收标准第 4 项） | 现有 `wave2Runtime` 已支持 tool_call 循环 | `apps/api` #731 |
| 转录/进度的线程内实时卡（对标验收标准第 9 项） | **已实现**，正是 #762 移除全局假 ambient-bar 时确认的替代实现 | `message-stream.tsx` 的 `chat-transcript-card` |

「全量换成 LangGraph」意味着上述这些**刚刚合并、刚刚被三个独立会话验证过的实现**大概率
要重新设计一遍——这正是提案需要先过评审的原因，不是执行速度问题，是「值不值得」的问题。

## 验收标准建议（如果评审后决定推进）

不新造第三份标准。沿用已有的两份（AGENTS.md 已明文「两份评分卡各自独立、都要满分、
不合并」的纪律）：
- 行为/端到端体验：`.harness/instructions/chat-ux-acceptance-criteria.md`（十项，coord-main
  用真实浏览器验收）
- 视觉/结构保真度：`.harness/rubrics/chat-main-fidelity-rubric.md`（issue #728）

若编排层换成 LangGraph，两份标准的**判据文字不需要改**——它们评的是「用户看到什么」，
不是「后端怎么实现的」。需要新增的是**第三份**：编排层迁移本身的正确性验收（新旧两条
执行路径产出是否等价、契约是否兼容、迁移期间双写/双读策略），这是传统的迁移验收，不是
UX 验收，应该走 `pnpm harness new-phase` + `feature_list.json` 的常规流程，而不是塞进
现有两份 UX 评分卡。

## 建议的下一步（不是本 agent 执行，是转交）

1. 人类或 coord-architecture 确认：#654 的裁决是否要正式撤销（扩大 LangGraph 范围）。
   如果是，请更新 `7033e798` 同等级别的一份新裁决文档，不要让两份文档同时存在制造漂移
   （AGENTS.md：「同一事实不得声明在两处」，本仓已因此漂移五次）。
2. 若确认要做：coord-architecture 出迁移 ADR（范围、阶段划分、回滚策略、与 #729/#731/
   #732/#699-703/#762 的并行冲突处理），coord-main 派工，走标准的
   `new-phase → requirements → design-signoff → feature_list.json` 流程。
3. 在评审结果出来之前，本 agent（#728）与其余并行会话按现有架构继续推进——这是当前
   唯一有正式授权、正在被独立评分、马上要交付的工作，不应该因为一个尚待评审的提案暂停。

---

*本提案由 dev-chat-e2e worker（issue #728 分支 `worker/dev-chat-e2e-01-chat-main-fidelity`）
于 2026-08-09 起草，未获任何架构裁决权。*
