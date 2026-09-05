# 契约束 `design-ai-collab` — 签核第 ② 件：用例

覆盖 feature：**B5.1 B5.2**（权威是 `design-signoff.md` frontmatter `covers:`）。
规范来源：`uc-17-8-go-live-backlog.md` §B5 + D7 裁决；`uc-17-8-研发闭环-反馈到设计到排期.md` R4.2 / R4.4。

## UC-B5.1 · 提交人在草稿「继续完善」浮层里与模型把边界谈清楚，提交时对话摘要进结构化字段

**主角**：草稿 owner。**入口**：草稿列表「继续完善」→ 浮层右栏对话。

```
UC: 追加一句对话
  in:  PATCH /feedback/drafts/:draftId { appendChat: { role: "user", kind: "message", text } }
  out: { draft }  —— draft.chat 末尾依次为 [首次才有：AI 澄清问题]、这句用户消息、AI 回复
  pre: 草稿存在且是本人的
  err: DRAFT_NOT_FOUND | DEPENDENCY_UNAVAILABLE（仅仓储不可用；模型不可用**不是**这个错，见失败模式）

UC: 提交草稿
  in:  POST /feedback/drafts/:draftId/submit
  out: { feedbackId, status: "待处理", chatSummary: "model" | "fallback" | null }
  pre: 正文非空
  err: DRAFT_NOT_FOUND | DRAFT_EMPTY | DEPENDENCY_UNAVAILABLE
```

1. 首次发送（`refineSeeded === false`）：服务端先让模型按 `kind` + 已填结构化字段 + 正文
   生成**一个**澄清问题（`source: "model"`），再追加用户消息，再追加针对这句的回复。
2. 之后每句：只追加用户消息 + 回复；模型看到的是完整 `chat[]`（不含 `edit` 记录）。
3. 提交：草稿上有 `kind: "message"` 记录 ⇒ 模型把整段对话摘要成该 `kind` 的结构化字段，
   摘出的覆盖同名、未摘的保留；随反馈落库；`chatSummary` 如实回报来源。没有对话 ⇒ 不调
   模型，`chatSummary: null`。

**验收线索**
- **V1**：首次发送后 `chat` 形如 `[ai(source), user, ai(source)]`，`refineSeeded` 置 true 且只 seed 一次。
- **V2**：模型在：澄清问题/回复文字来自模型，`source: "model"`；模型 prompt 含 kind、结构化字段、正文、按序历史。
- **V3**：模型失败/超时/空输出：追加不失败，AI 记录 = `REFINE_SEED_QUESTION`/`REFINE_ACK`，`source: "fallback"`，浮层显示「固定回执」。
- **V4**：提交时摘要按 kind 严格解析（别 kind 的键丢弃、非字符串丢弃），覆盖同名保留其余；`chatSummary: "model"`。
- **V5**：摘要失败/不可解析 ⇒ 草稿原 `structured` 原样提交，`chatSummary: "fallback"`；无对话 ⇒ `null` 且不调模型。

**失败模式（穷举）**
| 情况 | 用户可见结果 | 标记 |
|---|---|---|
| 模型 provider 未配置 / 网络错 / 超时（30s 回复、60s 摘要） | 对话照常追加，AI 句子是固定回执 | `source: "fallback"` |
| 模型输出为空/全空白 | 同上 | `source: "fallback"` |
| 摘要 JSON 不可解析 / 只有别 kind 的键 | 提交成功，字段不变 | `chatSummary: "fallback"` |
| 仓储不可用 | 503 `DEPENDENCY_UNAVAILABLE`（既有行为） | — |
| 客户端在 `appendChat` 里传 `source` | 契约 `.strict()` 拒收 | — |

## UC-B5.2 · owner 在设计详情左栏与模型对话，回复可写回 `problem/criteria/frames`

**主角**：设计项目 owner。**入口**：`/platform-admin/design-workbench/<id>` 左栏「设计协作」。

```
UC: 发一句设计协作消息
  in:  POST /pm-designs/:projectId/chat { text }
  out: { project, reply: { source: "model" | "fallback", applied: ("problem"|"criteria"|"frames")[] } }
  pre: 项目存在；请求者是 owner
  err: PROJECT_NOT_FOUND | NOT_PROJECT_OWNER | DEPENDENCY_UNAVAILABLE
```

1. 模型上下文 = 本项目 `name/template/problem/criteria/frames` + 本项目完整 `chat[]`
   （每项目独立：只喂本项目历史，thread 身份即 project id）。
2. 模型输出 `{ reply, writeback?: { problem?, criteria?, frames? } }`；`writeback` 经
   `DesignChatWriteback` 严格解析，合法字段**直接写回**项目（owner 谓词 UPDATE），
   `applied` 列出真的写了哪些；`frames` 只是画布页标签文案，画布仍是占位块。
3. 追加 `[user, ai(source)]` 两条；返回写回后的完整 `project`。

**验收线索**
- **V6**：模型在：回复文字来自模型，`source: "model"`；prompt 含项目五个字段与按序历史，且**不含**别的项目的历史。
- **V7**：模型给了合法 `writeback` ⇒ 对应字段更新、`applied` 如实列出、详情页气泡下方显示「已更新：…」；没给/不合法 ⇒ 字段不变、`applied: []`。
- **V8**：模型失败/超时/空输出 ⇒ 追加不失败，AI 记录 = `DESIGN_WORKBENCH_CHAT_REPLY`，`source: "fallback"`，`applied: []`。
- **V9**：非 owner ⇒ `NOT_PROJECT_OWNER`，不调模型、不写任何东西。

**失败模式（穷举）**
| 情况 | 用户可见结果 | 标记 |
|---|---|---|
| 模型不可用/超时/空输出 | 消息照常追加，回复是固定回执 | `reply.source: "fallback"`，`applied: []` |
| 输出不是 JSON / `reply` 缺失 | 把整段输出当回复文字（若非空）；不写回 | `source: "model"`，`applied: []` |
| `writeback` 某字段不合法（非字符串数组、超长、空数组） | 该字段不写，其余合法字段照写 | `applied` 不含它 |
| 写回成功但追加消息失败 | 字段已更新、对话缺这一轮；记日志，返回 503 | — |
| 非 owner | 403 `NOT_PROJECT_OWNER`（既有） | — |
