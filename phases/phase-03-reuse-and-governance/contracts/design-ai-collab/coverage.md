# 契约束 `design-ai-collab` — 支撑材料：UC 覆盖证明

> 覆盖 feature：**B5.1 B5.2**（派生视图；权威是 `design-signoff.md` frontmatter `covers:`）。
> 验收线索 V1–V9 来自 [usecases.md](./usecases.md)。
> **两个方向都要查**：UC → API（接口够不够）与 API → UC（接口是不是多余的）。

已建成并可引用的两处：`components/design-loop/drafts-screen.tsx`（`RefineOverlay`）·
`components/design-loop/detail-screen.tsx`。

## 一、UC → API

| V | 一句话 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 首次发送 seed 一次澄清问题，`chat` 形如 `[ai, user, ai]` | `feedbackLoop.updateFeedbackDraft`（`appendChat`；`refineSeeded`） | `draft-refine-send` → `draft-refine-chat` | ✅ |
| V2 | 模型在：澄清问题/回复来自模型，prompt 含 kind/字段/正文/历史 | `feedbackLoop.updateFeedbackDraft`（`chat[].source = "model"`） | `draft-refine-turn-ai-message` | ✅ |
| V3 | 模型失败：不 503，退回固定回执并标 fallback | `feedbackLoop.updateFeedbackDraft`（`chat[].source = "fallback"`） | `draft-refine-turn-fallback` | ✅ |
| V4 | 提交时对话摘要成结构化字段（按 kind 严格解析，覆盖同名保留其余） | `feedbackLoop.submitFeedbackDraft`（`out.chatSummary = "model"`） | `draft-refine-submit`（结果进收件箱 `inbox-*`，字段随反馈展示） | ✅ |
| V5 | 摘要失败原样提交；无对话不调模型 | `feedbackLoop.submitFeedbackDraft`（`out.chatSummary = "fallback" \| null`） | `draft-refine-submit` | ✅ |
| V6 | 设计对话回复来自模型；只喂本项目历史 | `designWorkbench.appendProjectChat`（`chat[].source = "model"`） | `design-detail-send` → `design-detail-chat` | ⚠ 待补（B5.2，PR 二） |
| V7 | 合法 writeback 直接写回 problem/criteria/frames，`applied` 如实 | `designWorkbench.appendProjectChat`（`out.reply.applied`；`DesignChatWriteback`） | `design-detail-chat-applied` / `design-detail-spec` / `design-detail-frame-{i}` | ⚠ 待补（B5.2，PR 二） |
| V8 | 模型失败退回 `DESIGN_WORKBENCH_CHAT_REPLY`，标 fallback | `designWorkbench.appendProjectChat`（`out.reply.source = "fallback"`） | `design-detail-turn-fallback` | ⚠ 待补（B5.2，PR 二） |
| V9 | 非 owner 不调模型不写回 | `designWorkbench.appendProjectChat`（`NOT_PROJECT_OWNER`，既有） | `design-detail-chat-error` | ✅（既有门；B5.2 加"不调模型"断言） |

## 二、API → UC（反向：本束声明的每个契约面都有 UC 要它）

| 契约面 | 要它的 UC | 备注 |
|---|---|---|
| `designAiCollab.AiReplySource` | V2 V3 V5 V6 V8 | 两束共用，只声明一次 |
| `FeedbackDraftChatTurn.source?` | V2 V3 | 输入侧 `appendChat` 不接受它 |
| `submitFeedbackDraft.out.chatSummary` | V4 V5 | |
| `DesignProjectChatTurn.source?` | V6 V8 | B5.2 |
| `appendProjectChat.out.reply` / `DesignChatWriteback` | V7 V8 | B5.2 |

没有任何契约面找不到 UC；没有任何 V 找不到契约面。本束**不新增路由**，故无孤儿路由可查。
