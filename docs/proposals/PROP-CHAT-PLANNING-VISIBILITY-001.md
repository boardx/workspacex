# 普通对话的 planning 阶段可见性——两条路线评估（PROP-CHAT-PLANNING-VISIBILITY-001）

> **状态：评估，待 coord-main 裁决。** 人类原型期待「提交问题 → 看到系统在 planning」。
> coord-main 拆解：planning 目前只在 deep-agent 路径有，普通 provider 零 planning。
> 本文评估两条路线 + 成本/时延 + 推荐，coord-main 裁。不实现，只决策输入。

## 一、现状（实测 origin/main）

- 一次 run 的 provider **按 run pin**（`run.modelProvider`，建 run 时从 agent version 定死），
  即「用哪个 provider」是 agent 级别的属性。
- **planning 可见 = `planningNote`**，只挂在 `tool_call` 步骤上
  （`AgentRunStep.planningNote` / `ports.ts:87`），且**从不合成**（`wave2-runtime.ts` 注释逐字：
  模型没在同一轮回复里给出 content 就显示为空，绝不编一句）。
- 产出 `tool_call` 步骤 + `planningNote` 的唯一路径是 `completeWithProgress`
  （#742，`DeepAgentModelProvider` → 远程 `apps/deep-agent-service`，Python）。
- 普通路径 `ConfiguredModelProvider.complete()`（dashscope 直聊）= 一次调用出一个最终答案，
  **没有** planning 步骤、没有中间可见性。
- ⚠ 硬约束（coord-main 裁决 A）：`ModelCallPort` 契约不动。任何方案在端口内侧做。

## 二、路线 A：把默认 agent 全部切到 deep-agent provider

**做法**：默认 agent 的 `modelProvider` 改成 deep-agent，planning/工具步骤天然就有。

| 维度 | 评估 |
|---|---|
| planning 可见性 | ✅ 天然有（deep-agent 的多步规划本就产出 planningNote + tool_call 步骤） |
| 时延 | 🔴 **每一次普通问答都走远程 deep-agent 多步编排**，即使是「几点了」这种一句话问题也要付多步规划的往返开销 |
| 基础设施 | 🔴 **把全部 chat 耦合到 `apps/deep-agent-service` 的可用性**——该 Python 服务挂了，不是「deep-agent 对话失败」，而是**所有对话失败**。目前它是否在 devapp 常驻、扩容如何，需确认 |
| 成本 | 🔴 所有对话都付 deep-agent 的 token + 编排成本，简单问答被显著抬价 |
| 与 #775 的关系 | ⚠ #775（CopilotKit+LangGraph 全量替换编排层）未裁决。强推全部 chat 走 deep-agent 是在编排层大方向未定时押一个重注 |
| 可逆性 | 🟡 改 agent 的 provider 字段可逆，但一旦用户习惯了 planning，退回去是体验倒退 |

## 三、路线 B：普通路径加轻量 planning

**做法**：普通 provider 路径也产出一段「我打算怎么做」的 planning，配合已上线的 thinking
动画，让用户全程看到进展。两个子变体：

- **B1（分离调用）**：主答之前先发一次 `complete()` 产出一句话计划，作为 planning 步骤
  落库/渲染，再执行主答。+1 次模型往返。
- **B2（单调用 plan+answer）**：改 prompt 让模型「先说一句计划，再作答」，从同一次回复里
  解析出计划段。省一次调用，但「计划 vs 正文」的解析脆弱。

| 维度 | B1 | B2 |
|---|---|---|
| planning 可见性 | ✅ 每个 agent 都有 | ✅ 每个 agent 都有 |
| 时延 | 🟡 +1 次模型往返（planning 阶段，thinking 动画覆盖等待） | ✅ 无额外往返 |
| 成本 | 🟡 +planning 段的 token | ✅ 仅 prompt 变长 |
| 基础设施 | ✅ 不引入新依赖，留在普通 provider | ✅ 同 |
| 诚实性 | ✅ 计划是独立一次真实生成，清晰可归属 | ⚠ 解析出的「计划段」若和正文边界不清，易滑向「合成 planning」——违反本仓 planningNote 从不合成的硬规 |
| 可逆性 | ✅ 开关即可关 | ✅ prompt 回滚 |

## 四、推荐

**推荐路线 B，开关门控（默认关，先受控验证再上生产），子变体优先 B1。**理由：

1. **不制造硬依赖**：路线 A 把全部 chat 的可用性押在 deep-agent 服务上——单点故障面从
   「deep-agent 对话」扩大到「所有对话」，这是最大的运营风险。B 留在普通 provider，
   deep-agent 服务与普通对话解耦。
2. **增量、可逆**：B 用开关（同 V8 摘要 / 流式的 opt-in 纪律），先在受控环境验证 planning
   质量与时延再上生产；A 是一次性的大架构切换。
3. **和刚上线的 thinking 动画天然配合**：B1 的 +1 往返等待期，正好由 thinking 动画覆盖，
   用户看到「正在思考/规划」，感知连贯。
4. **不和 #775 抢方向**：编排层大方向（#775）未裁决前，不把全部 chat 强推进 deep-agent。
5. **B1 优于 B2 的关键**：诚实性。B2 从单次回复里切「计划段」，边界不清就滑向「合成
   planning」，违反本仓「planningNote 从不合成」硬规；B1 的计划是独立一次真实生成，
   归属清晰、可验证。若成本敏感再评估 B2，但要先解决解析归属问题。

**需要 coord-main 裁的**：
- A / B 二选一（推荐 B1）。
- 若选 B：planning 开关名（建议 `KERNEL_CHAT_PLANNING_ENABLED`，同 opt-in 纪律）；
  planning 落库为一个新的非 tool_call 步骤种类还是复用现有结构——**后者可能要动契约
  （`AgentRunStepKind`），需 design-signoff**；实现要动 execute-run.ts，需串行窗口。
- 若选 A：先确认 `apps/deep-agent-service` 在 devapp 的常驻/扩容/故障预案，再切。

## 五、我可能没覆盖到的
- deep-agent 服务在 devapp 的真实部署状态（常驻？扩容？）我没实测，路线 A 的基础设施
  风险是基于「它是远程 Python 服务、需常驻」的架构事实推断，具体运营现状请 coord-main
  或运维确认。
- B1 的 planning 质量（模型产出的计划是否对用户有价值、还是套话）需要真实模型下的样本
  评估，本文只评机制不评产出质量。

---

*本文档由 dev-chat-e2e worker 2026-08-11 整理，评估不实现，待 coord-main 裁决。*
