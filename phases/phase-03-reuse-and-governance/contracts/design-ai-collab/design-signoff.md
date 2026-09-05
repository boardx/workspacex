---
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-09-05T08:00:00Z"
bundle: design-ai-collab
scope: uc-17-8-ai-collab
covers: [B5.1, B5.2]
---

# AI 协作（草稿「继续完善」+ 设计详情对话接模型）—— 设计签核

规范来源：`phases/phase-03-reuse-and-governance/requirements/17-gov/uc-17-8-go-live-backlog.md`
§B5 · `packages/contracts/src/design-ai-collab.ts`（本束新增的共用词汇）+
`feedback-loop.ts`（`updateFeedbackDraft` / `submitFeedbackDraft`，B5.1 改语义）+
`design-workbench.ts`（`appendProjectChat`，B5.2 改语义）。

**本文件的 `status` 归人类所有——agent 不得改**（ADR-023）。

---

## ⚠ 实现先行、等人类签核——如实写在这里

同 `feedback-loop` / `design-workbench` 两束的先例：B5.1 / B5.2（两个 PR，见 backlog §0.4）
的实现与本目录的五件材料一起交付，`status` 保持 `pending`，
由人类签核后才允许把 B5.x 标 `passing`。ADR-023 的顺序（先签后做）在这一束上再次被打破——
原因是 D7 裁决（2026-09-02）把 AI 项后置成本束时，两块对话面板的固定回执版本已经上线，
本束改的是**同两块面板的数据流**，材料对着已跑起来的代码写，比对着尚未存在的代码写更真。

**后果**：代码合入 `main` 后立即生效（模型配置齐全时对话由模型生成，否则退回固定回执并
如实标记），但 B5.1 / B5.2 在 `status` 改为 `confirmed` 前**不得标 `passing`**。

---

## ① UI

**B5 不新增任何屏。** 改的是两块既有对话面板里「AI 说的话从哪来」：

- 草稿「继续完善」浮层（`components/design-loop/drafts-screen.tsx` `RefineOverlay`，
  截图 `drafts-refine-light`）——澄清问题与回复由模型按 `kind` + 结构化字段 + 历史生成；
- 设计详情左栏「设计协作」（`components/design-loop/detail-screen.tsx`，截图
  `detail-canvas-dark`）——回复由模型按项目上下文生成，且可写回 `problem/criteria/frames`。

布局、`data-testid`、七态全部不变；**变的只有气泡里的文字**。两处各新增一个小标识：
AI 记录 `source: "fallback"` 时显示「固定回执」（B5.1 `draft-refine-turn-fallback`；
B5.2 `design-detail-turn-fallback`），B5.2 回复写回了字段时在最后一条 AI 气泡下显示
「已更新：验收标准 / 背景 / 画布页」（`design-detail-chat-applied`）。
截图沿用两个既有束的材料（复制进本束独占目录，见 [ui.md](./ui.md) 头注），**没有为
新标识重拍**——标识是一行 10px 的 token 化文字，不改变屏的判断；签核时若认为需要看到
它，`⚠ 未产出` 条目在 `ui.md` 里点名。

## ② 用例

见 [usecases.md](./usecases.md)（UC-B5.1 / UC-B5.2，验收线索 V1–V9）。
**失败模式是本束的重点**：模型不可用 / 超时 / 输出不可解析 / 写回字段不合法——每一种的
用户可见结果与 `source` 标记都在那里穷举；「静默退回固定回执装成模型说的」被明确列为
不允许的行为。

## ③ API 契约

- `packages/contracts/src/design-ai-collab.ts`：`AiReplySource`（`model` / `fallback`）——
  两束共用、只属于「AI 协作」能力域的词汇，只声明一次。
- `feedback-loop.ts`：`FeedbackDraftChatTurn.source?`（AI 记录）；`updateFeedbackDraft.in.appendChat`
  不接受 `source`；`submitFeedbackDraft.out.chatSummary: AiReplySource | null`。
- `design-workbench.ts`（B5.2）：`DesignProjectChatTurn.source?`；`appendProjectChat.out` 增
  `reply: { source, applied: DesignWritebackField[] }`；`DesignChatWriteback` 声明模型可写回的形状。

**没有新路由**，理由见 `design-ai-collab.ts` 头注「本文件为什么没有自己的 `operations`」。

---

## 签核前请人类确认的三件

1. **走 `ModelCallPort.complete` + 固定模型配置，不走 deep-agent-service 的 agent-run**
   （取舍见 [domain.md](./domain.md) §3）。backlog 原文写「接 deep-agent-service」；本束
   的解读是「接模型」，deep-agent-service 是这个部署里 `ModelCallPort` 的一个 provider——
   若人类的本意是**必须**用 LangGraph thread/HITL 那套机制，这条要重裁。
2. **退路策略**：模型失败时**不让操作失败**，退回 D7 固定回执并标 `fallback`（对比
   `structureFeedbackDraft` 失败**抛** 503）。理由：用户那句话已经落库，AI 没回好不该让它丢。
3. **B5.2 写回是「直接写回 + 返回 `applied`」，不是「返回建议等用户确认」**（理由见
   `design-workbench.ts` `appendProjectChat` 头注）。若人类希望先确认再写回，这条要重裁。
