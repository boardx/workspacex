# 原始需求（细化）— UC-8.9 对话 thinking 推理正文可视化

> 所属：阶段一 · 能跑完一场项目 / M8 Chat
> 来源：人类 2026-08-14 原话「如果 chat 有 thinking 的内容需要可视化在 message 里面」
> + 同日调研澄清 + 同日 `AskUserQuestion` 隐私取舍裁决（见下方【人类已裁决】块）。

> 口径（四标记）：本 UC 无 `[原型]`（折叠展开的容器 UI 已存在，见「现状」一节，不新增界面形态）。
> 行为为 **[Backlog]**（人类直接下发）+ **[待设计]**（契约新增字段尚未起草 domain/usecases，
> 需走 `contracts/chat-context-engine` 束的补充签核，因为它修订了该束已签的隐私边界）。
> **本文件不能直接开工**：需先补 `contracts/` 三件套（UI 沿用现状可从简，用例 + API 契约必须补），
> 经人类在束级 `design-signoff.md` 追加签核后才可进 `feature_list.json`。

## 现状先讲清楚——这不是"渲染形式不够好"，是数据没被采集

2026-08-14 调研已确认（详见 `phases/phase-01-run-a-project/contracts/chat-context-engine/` 现有代码事实）：

- 每条 AI 消息展开态的"思考了 X 秒"折叠块（`MessageThinkingChain` → `AgentToolChain`）已经存在，
  但只渲染 `AgentRunStep.kind === "tool_call"` 的 `planningNote`（模型调工具前顺带说的一句话）。
- 当模型是**直接作答**（没有调用任何工具）时，展开态**只有一句**「本次没有工具调用，模型直接
  作答」——除了耗时秒数，没有任何推理内容可看。
- 契约层（`packages/contracts/src/wave2-runtime.ts` `AgentRunStep`）的 `inputDigest`/`outputDigest`
  字段文档原话「Digests, not content」——模型的 prompt/response 正文**只存 SHA-256 哈希，不留原文**，
  这是既有隐私策略 §5 的既定约束。
- `Message.thinkingSummary`（`packages/contracts/src/chat.ts`）字段虽然存在，但后端两条读路径
  （`get-thread.ts`、`admin-audit-read.ts`）**恒硬编码返回 `null`**，从未被真正填充过。

一句话：用户点开"思考了 25.1 秒"想看模型到底想了什么，看到的是空的——不是画得不好看，
是这段文字在系统里根本没有留存的副本。

## 【人类已裁决 2026-08-14 · 隐私取舍】

针对"要真正展示推理内容，就必须为 thinking 文本开一个例外、持久化这段文字"这一取舍，
人类在 `AskUserQuestion` 里逐字选择：

> 「允许持久化 thinking 正文（推荐，仅限 thinking，不含 prompt/response 其余部分）」

即：**只对模型的推理/思考文本本身开例外**；工具调用的输入输出、消息正文其余部分仍然
按既有策略只存摘要/哈希，**不因本 UC 扩大到整个 prompt/response**。这条边界是硬约束，
不得在后续设计/实现里顺手放宽。

## R1 概览

- **Use Case ID / 名称**：UC-8.9 / 对话 thinking · 推理正文可视化
- **Actor**：对话参与者（消息的查看者，含发起者与其他有可见权限的人）；间接为系统（run 组装/
  持久化层需要新采集一段文本）。
- **目标**：模型真正产生了推理/思考内容（无论是否伴随工具调用）时，用户展开"思考了 X 秒"
  能看到这段推理文本本身，而不是只看到耗时或一句「模型直接作答」的空话。
- **本用例结果**：`AgentRunStep`（或等价载体）新增一个**仅存原文、不再是哈希**的推理文本字段，
  仅当模型 provider 真的返回了 thinking/reasoning block 时才被填充；`AgentToolChain`（或其
  升级形态）展开态渲染该字段的 markdown 原文。
- **系统边界**：契约 `packages/contracts/src/wave2-runtime.ts`（新增字段）；后端采集链
  `apps/api/src/application/agent-run/writeback.ts` / `execute-run.ts`（从 provider 响应里
  摘出 thinking block，不再只落哈希）；前端 `apps/web/components/chat/agent-tool-chain.tsx`
  或 `message-thinking-chain.tsx`（展示新字段）。
- **核心数据对象**：`AgentRunStep` 新字段（暂拟 `reasoningText: string | null`，`kind` 不限
  `tool_call`——"直接作答"场景也可能有推理文本，这条不能重复 UC-8.7 的旧假设）。

## R2 前置条件 / 触发条件

- **前置条件**：一次 agent run 已执行完成（`writeback` 阶段）；上游 model provider 在这次调用
  里实际返回了 thinking/reasoning block（不是所有 provider/model 都会返回——没有就不填充，
  不伪造）。
- **触发条件**：`writeback.ts` 落库这次 run 的 step/message 时，若 provider 响应里带有推理
  内容，一并落这段原文（而不是只算 `outputDigest` 哈希）。

## R3 主流程（草案，供 requirement-author 细化，不是最终判据）

1. **系统处理（采集）**：`execute-run.ts`/`writeback.ts` 从 model provider 的响应里识别并摘出
   thinking/reasoning block 原文（不同 provider 的响应形态可能不同，需要一层归一化，具体由
   实现阶段定，本文件不预设 provider 差异细节）。
2. **系统处理（持久化）**：把摘出的推理原文写入新契约字段（不再是哈希摘要）；未产生推理内容
   的 run（多数 provider 的默认非 thinking 模式）该字段为 `null`，如实呈现，不伪造。
3. **系统响应（展示）**：消息展开态渲染该字段的原文（markdown），无论这次 run 是否有工具调用；
   字段为 `null` 时维持现状的空态提示（不是本 UC 引入新的误导性占位）。

## R4 边界与不做的事

- **不扩大到 prompt/response 其余部分**：工具调用的入参/结果、非 thinking 的模型正文，
  仍按既有策略只存摘要/哈希——这是人类裁决明确划的线，见上方【人类已裁决】块。
- **不对不支持 thinking 的 provider/model 伪造推理文本**：该字段为 `null` 就如实显示"这次
  没有可展示的推理内容"，不能编造。
- **不在本文件里给出最终的字段名/表结构/API 形状**——这些属于 `contracts/` 三件套的设计
  产出，需人类在束级签核里逐字确认（沿用 `chat-context-engine` 束既有的严谨度）。

## R5 待办（requirement-author 与契约设计阶段需要回答）

1. 这个字段挂在 `AgentRunStep` 上，还是挂在 `DurableMessage`（如现有的 `thinkingSummary`
   字段，只是把它从"恒 null 的摆设"改成"真的填充"）？两者语义不同（step 级 vs message 级），
   需要设计阶段定夺，不由本文件预先决定。
2. 不同 model provider（OpenAI/Anthropic/deep-agent 等）返回 thinking 内容的形态差异如何
   归一化，是否需要每个 provider adapter 各自实现一层摘取逻辑。
3. 推理原文的长度/存储成本上限如何定（是否需要类似 L1/L2 的预算裁剪）。
4. 该字段是否需要参与既有的 context-pack/L2 摘要逻辑（推理内容本身要不要被后续轮次的摘要
   吸收），或严格与上下文组装解耦、只做单轮展示用途。
