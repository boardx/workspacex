# 契约束 `design-ai-collab` — 支撑材料：领域模型

> 覆盖 feature：**B5.1 B5.2**（权威是 `design-signoff.md` frontmatter `covers:`）。

## 1. 实体：本束**不新增实体**

本束作用在两个已有实体的既有字段上：

| 实体（所属束） | 本束碰的字段 | 本束加的东西 |
|---|---|---|
| 反馈草稿 `FeedbackDraft`（`feedback-loop`） | `chat[]`、`structured`、`refineSeeded` | `chat[].source`（AI 记录）；提交时 `structured` 由对话摘要覆盖 |
| 设计项目 `DesignProject`（`design-workbench`） | `chat[]`、`problem`、`criteria`、`frames` | `chat[].source`（AI 记录）；回复可写回后三者 |

值对象 **`AiReplySource`**（`model` / `fallback`）是本束唯一新增的词汇，声明在
`packages/contracts/src/design-ai-collab.ts`，两束 `import`，不各抄一份。

## 2. 不变量（能写成断言的）

- **I-1 用户的话先于 AI 的回复落库，且不因 AI 失败而丢。** 对任一次 `appendChat`/
  `appendProjectChat`，写回的 `chat[]` 必含这条用户消息；模型失败 ⇒ 仍写入，AI 记录取
  固定回执。断言：`chat.filter(role==="user").length` 单调不减，且从不因模型错误回滚。
- **I-2 AI 记录必标来源，且来源如实。** `role: "ai"` 且由本束写入的记录 ⇒ `source ∈
  {model, fallback}`；`source === "model"` ⇔ 文字来自这次模型调用的非空输出。旧记录
  （B5 之前）与 `user` 记录无 `source`——「无」≠「模型说的」。
- **I-3 首次澄清问题只 seed 一次。** `refineSeeded` 由 false→true 恰好一次；模型失败也置
  true（退路文案就是那一次 seed），不会下次再问一遍。
- **I-4 对话历史单一事实源在实体自己的 `chat[]`。** 模型每次看到的历史 = 读库得到的
  `chat[]`，不存在第二份副本（远端 thread / 内存缓存）——见 §3。
- **I-5 摘要只按 `kind` 写字段，且只覆盖不清空。** 提交时摘出的字段 ⊆ 该 `kind` 契约声明的
  键（`.strict()`），摘出的覆盖同名、未摘的保留原值；退路 ⇒ `structured` 与草稿上一致。
- **I-6 写回形状受契约约束。** B5.2 模型建议的 `problem/criteria/frames` 必须通过
  `DesignChatWriteback` 严格解析才落库；任一字段不合法 ⇒ 该字段不写，`applied` 不含它。
  `frames` 是画布页标签文案；画布内容（`prototype`）的写回规则见 `design-prototype` 束（B5.3，2026-09-06 起）。
- **I-7 owner 谓词不变。** 写回 `problem/criteria/frames` 走与 `updateProject` 同一条
  `owner_id = $n` 谓词的 UPDATE；非 owner 发消息仍是 `NOT_PROJECT_OWNER`。

## 3. 取舍：走 `ModelCallPort.complete`，不走 agent-run

backlog 原文「接 deep-agent-service」。仓库里有两条路：

| 路 | 是什么 | 为什么不选 / 选 |
|---|---|---|
| A. agent-run（`deep-agent-engine-run-controller.ts` / `accept-message-plan-run-creator.ts`） | 一次 run = 远端 LangGraph thread + 事件流 + 工具循环 + HITL + 计划控制；thread 由 `threadId` 决定性对齐（uuid5） | 对话历史会在远端 checkpointer 里再存一份（违反 I-4）；每轮要走事件流才拿到最终文本；HITL/工具/计划这里都用不上。**不选** |
| B. `structureFeedbackDraft` 那条链（`ModelCallPort.complete` + `FEEDBACK_STRUCTURE_MODEL_CONFIG`） | 单次补全，固定 provider/modelId，`system`+`user`，JSON 输出容错解析 | 同一端口、同一配置、同一解析纪律（`parseStructuredForKind`）；历史整段喂进 `user`，单一事实源不动。deep-agent-service 在这个部署里就是 `MODEL_CALL_PORT` 的 provider 之一（`RoutingModelCallPort`），所以「接 deep-agent-service」在这条路上也成立。**选** |

⚠ **不传 `threadId`**（同 `structureFeedbackDraft`/`generateThreadTitle` 的纪律）：传了会让
`DeepAgentModelProvider` 把这次调用当成要接续的 Chat 会话并在远端建 thread——那就是 I-4
的第二份副本。「每项目独立 thread」（B5.2 原文）由 `design_project_chat_messages` 按
`project_id` 隔离 + 每次只喂本项目历史来满足，thread 的身份就是 project id，不另造 id。

## 4. 退路：失败不抛，如实标记

`structureFeedbackDraft` 失败**抛** `STRUCTURING_FAILED`——那次点击唯一要做的事就是整理，
静默返回空表单等于假装成功。本束不同：用户点击的主动作是「把我这句话记下来」，那句话已
落库；AI 没回好不该让整次操作 503。所以退回 D7 固定回执，`source: "fallback"`，前端显示
「固定回执」标识。**静默退路（不标记）是本束明确禁止的行为**（I-2）。
