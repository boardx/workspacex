# Chat 上下文引擎设计（PROP-CHAT-CONTEXT-ENGINE-001）

> **状态：设计，未实现。** 对应 10 轮迭代计划（`CHAT-10-ITER-PLAN.md`）的 V8（契约无关的
> 端口内侧真改进）与 V10（把已有 context-pack/retrieval 引擎接进 chat）。本文档是「深入研究
> context engine」的落地设计，写在实现之前，供 coord-main / 人类评审。
>
> 边界（coord-main 2026-08-11 裁决 A 的条件）：**`ModelCallPort` 契约不动**
> （`complete` / `completeStream` / `completeWithProgress` / `supportsProgress` 的签名与语义）。
> 一切改进在端口**内侧**——即 `execute-run.ts` 组装 `ModelCallInput` 之前的那段窗口。
> 动 `execute-run.ts` 前先向 coord-main 取串行窗口。

## 1. 现状（实测 origin/main，两份独立勘探）

一次 agent run 的上下文组装全在 `apps/api/src/application/agent-run/execute-run.ts:executeClaimed`：
- **system** = `buildSystemPrompt(instructions, skills)` = agent 指令 + 各 pinned skill 的 SKILL.md 正文；
- **user** = 本轮 `run.inputText`；
- **history** = `readThreadHistory`（`pg-agent-run-repository.ts:468`）取本轮之前最近 N 条，
  经 `trimHistoryToBudget` 从**最旧整条丢弃**直到后缀合计 `content.length` ≤ 预算。
- 预算常量：`HISTORY_MAX_MESSAGES = 20`（SQL 行数上限）、`HISTORY_MAX_CHARS = 12_000`（字符预算）。
- **没有**：摘要、真 token 计数（全仓无 tokenizer，4 chars/token 只是保守代理）、记忆、检索、附件。

另有一整套**已写好但未接线**的检索式上下文引擎：`application/context-pack/*` +
`application/retrieval/*`（五路召回 RRF）+ `domain/context-pack/*` + 契约 `contracts/context-pack.ts`
+ 权威架构 `docs/architecture/context-engine.md`（2026-07-28）。它有 domain/测试，**但无 HTTP
端点、无 agent-run 集成**，服务的是 Studio(uc-0-2) 不是 chat。`build-items.ts` 自述
「until then nothing calls it in production」。

## 2. 现状最大缺口（决定做什么）

| # | 缺口 | 后果 | 归属版本 |
|---|---|---|---|
| G1 | 长对话超预算就**整条丢旧轮**，无压缩 | 超 12k 字符后「记得前几轮」必然掉线（验收#6 失分根因） | V8 |
| G2 | **无 token 真值**，预算是字符代理 | 无法做真正的窗口预算/成本核算；不同模型窗口差异无法利用 | V8 |
| G3 | 检索/记忆引擎存在却**未接线** | chat 无法注入项目知识；重复造桥或接现成引擎二选一 | V10 |
| G4 | **附件通道空缺** | 见 V9（附件），本文不覆盖 | V9 |
| G5 | 每次 run **重读全量历史现拼**，无会话级上下文状态/快照 | 无法审计「这次到底喂了什么」（现仅存 sha256 摘要于 agent_run_steps） | V8/V10 |

## 3. V8 设计：端口内侧的历史压缩 + token 预算（契约无关）

**目标**：把 G1（丢旧轮）与 G2（无 token 真值）在**不改 `ModelCallPort`**的前提下解决。

### 3.1 引入一个 application 层新 port：`ContextAssemblyPort`
与 `AgentRunStore` / `ModelCallPort` 并列（`ports.ts` 符号定义处），由 composition root 注入。
`execute-run.ts` 在「system 已定、history 已取、调 model 之前」的窗口调用它，产出最终的
`ModelCallInput.history`。**它不碰 `ModelCallPort`，只决定喂进去的 history 长什么样。**

```
interface ContextAssemblyPort {
  // 输入：原始历史（已按 HISTORY_MAX_MESSAGES 行数取回）+ 预算
  // 输出：可能包含「摘要伪消息」的、控制在预算内的历史
  assemble(input: {
    rawHistory: ThreadHistoryMessage[];   // role+content，现有形状不变
    budget: ContextBudget;                 // 见 3.3
  }): Promise<{
    history: ThreadHistoryMessage[];       // 仍是 role+content，ModelCallInput 不变
    summarizedTurns: number;               // 观测：压了几轮，写进 agent_run_steps 的 digest
  }>;
}
```

**关键：输出仍是 `ThreadHistoryMessage[]`（role+content），`ModelCallInput` 与 `ModelCallPort`
一个字节不改。** 摘要以一条 `role:"user"`（或约定的 system 前缀）的「伪历史消息」注入，
内容形如「[前 N 轮摘要] …」。这样 #775 若真的来、换掉编排层，这段逻辑作为端口实现天然可迁移。

### 3.2 滚动摘要（解决 G1）
- 预算内的**近**若干轮原样保留；超预算的**旧**轮不再整条丢弃，而是喂给一个**摘要调用**
  压成一段要点，占位远小于原文。
- 摘要调用**复用 `ModelCallPort.complete`**（不新增端口方法）——用同一个已配置模型，
  一次小的 summarize 请求。失败降级：摘要失败**不 fail run**，退回现有的「整条丢弃」行为
  （与现在 `readThreadHistory` 失败降级为单轮同一种保守失败模式）。
- 摘要结果可缓存进 `agent_run_steps` 的 digest 或一张新表（见 3.4），避免每轮重算。

### 3.3 token 预算（解决 G2）
- 现状 4 chars/token 是硬编码代理。V8 引入一个 `TokenEstimatorPort`（也在端口内侧）：
  - **默认实现**：保守字符估算（与现状等价，零风险默认）；
  - **可选实现**：若部署接入了真实 tokenizer，注入真实计数。
- 预算类型 `ContextBudget = { maxTokens: number, reserveForResponse: number }`，
  由模型的真实窗口推导（不同 model 不同），替代写死的 12_000 字符。

### 3.4 可审计的上下文快照（解决 G5，可选）
- 现状只在 `agent_run_steps` 存 sha256 digest。V8 可选加一张 `agent_run_context`（或复用 step 的
  一个 jsonb 列）存**这次实际喂进去的 history 结构**（摘要了哪几轮、token 估值），
  让「这次到底喂了什么」可审计。**这一步涉及新表 → migration → 契约 → 需 design-signoff**，
  归入「备签」，不阻塞 3.1–3.3 的纯组装改进。

### 3.5 V8 落地边界
- 改 `execute-run.ts`（热点）→ 先向 coord-main 取串行窗口。
- `ModelCallPort` 不动（裁决 A 条件）。
- 3.1–3.3 契约无关，可先落地 + 真栈 e2e 验证「长对话仍记得前几轮」。
- 3.4（快照表）契约相关，备签，不阻塞前三节。

## 4. V10 设计：把已有 context-pack/retrieval 引擎接进 chat

**目标**：解决 G3——让 chat 能注入项目知识（检索式上下文），复用已存在的 F09–F13 引擎，
不重造。

### 4.1 为什么是「接线」不是「重写」
`docs/architecture/context-engine.md` 已定稿：items/claims/omissions 三段结构、五路召回、
权限约束检索、Context Pack 交付可引用上下文。`application/retrieval/*` + `application/context-pack/*`
有 domain + 测试。缺的只是**调用方**（无 controller、无 agent-run 集成）。

### 4.2 接线点
在 V8 的 `ContextAssemblyPort.assemble` 内部，历史组装之后、产出 `ModelCallInput.history` 之前，
可选调用 context-pack 引擎：
- 用本轮 `inputText` 作为 query，在**当前 thread 所属项目**范围内召回可引用上下文；
- 把 Context Pack 作为一段「检索上下文」注入 history（同样是 role+content 伪消息，`ModelCallInput` 不变）；
- **权限**：context-pack 引擎本身是权限约束检索（架构文档明写），接线时必须把当前 actor 的
  可见范围传进去——个人对话无项目 ⇒ 不召回（与 P 组「无项目上下文如实呈现」一致，不伪造）。

### 4.3 V10 落地边界（深水区）
- **跨域接线** + 可能的契约变更（context-pack 的调用契约）→ **需 design-signoff**（人类）。
- 我会把 4.1/4.2 做成**设计 + 可落地骨架 + 待签处**，裁决问 coord-main，签核等人类。
- 个人对话不召回这条要有真栈 e2e 反证（无项目 ⇒ 零检索请求），防止「假注入」。

## 5. 分期与依赖

```
V8（本文 §3）：ContextAssemblyPort + 滚动摘要 + token 预算（端口内侧，契约无关）
  ├─ 3.1–3.3 可落地：改 execute-run.ts（取 coord-main 串行窗口）+ 真栈 e2e
  └─ 3.4 快照表：备签（新表/契约）

V10（本文 §4）：把 context-pack/retrieval 接进 §3 的组装窗口
  ├─ 依赖 V8 的 ContextAssemblyPort 已就位
  └─ 跨域接线 + 契约：备签（人类 design-signoff）
```

## 6. 需要 coord-main / 人类的

- **coord-main**：V8 动 `execute-run.ts` 的串行窗口确认（裁决 A 已给条件：ModelCallPort 不动）。
- **人类 design-signoff**：3.4 上下文快照表、V10 的 context-pack 调用契约。
- **裁决**：摘要复用同一 model（§3.2）vs 单独配一个更便宜的 summarize model——前者零新配置、
  后者省钱但要新环境变量。建议先前者（零配置），有成本诉求再拆。

---

*本文档由 dev-chat-e2e worker 2026-08-11 夜间自主开发期间整理，基于两份独立 codebase-researcher
勘探（实测 origin/main），不代表任何代码已改动。*
