# v1 错在哪 —— agent-runtime 私聊屏逐条对照原型证据（给签核人看）

> v1 在 `ui-preview/agent-runtime/`（48 张）保留不动。v2 在 `ui-preview/agent-runtime-v2/`（49 张 = 39 张非私聊屏原样复制 + 10 张私聊屏重拍），
> 路由沿用 `/preview/agent-runtime?screen=chat`。证据来自 `phases/requirements/WorkspaceX Standalone.html`（17MB，按字节偏移抽取）。
>
> **本轮关键：私聊屏的证据在 16.60–17.05M 的 JS 数据区与路由表，点原型点不到。** 上一版审计只做了定点抽取、没通读那个数据区，
> 于是三重否证。下面逐条给出数据区的原文。

---

## 错误 1 · 「私聊」被误判为人际私聊——原型 `AG` 数组明确定义 6 个可单独私聊的 agent

- **v1 做了什么**：`chat-screen.tsx:101` 逐字写「档案里的『私聊』全指人际私聊」，据此只画了**单个 Ava** 的私聊面板，
  没有可切换的 agent 花名册。
- **为什么错**：原型的 `AG` 数组（偏移 **17044000–17048000**）定义了 **6 个 agent**，每个都带
  `key / model / skills / quick / lines / ph（占位符）`，并生成 `teamList`——侧栏「本线程的 AI 团队 · 6」
  每行是一个 `<button title="点开与这个 agent 单聊" onclick=set({agentChat:key})>`。这明确是**与 agent 单聊**，不是人际私聊。
- **原型证据**：
  - 6 个 agent（偏移 17044000 起）：`Ava · 战略分析师`（opus-4.6·主动插话开）/ `Atlas · 流程诊断`（sonnet·读流程库）/
    `Scout · 同行情报`（3 并行·主动插话开）/ `Ledger · 收益测算`（本地模型·需批准·跑批中）/
    `Warden · 风险与合规`（命中即拦·主动插话开）/ `Echo · 访谈综合`（被动·仅被 @ 时出现·空闲）
  - `agentChatOpen = !!s.agentChat`（偏移 **16721252**）；`closeAgentChat: () => set({ agentChat: null })`（偏移 **16721459**）
  - 抽屉输入框注脚：`只和这个 agent 单聊，不进主线程`（偏移 16724872）
  - 花名册渲染：`本线程的 AI 团队 · 6` + `<button title="点开与这个 agent 单聊">`（偏移 15042100）
  - **讽刺之处**：v1 用同一个 `AG` 数组填了主持台名单（`team-screen`，`THREAD_AI_TEAM` 六人同名），
    却在隔壁 chat 屏说这块数据不存在。
- **v2 修正**：`AGENT_CHAT_ROSTER`（6 agent，逐字复刻 model/skills/quick/lines/占位符）+ `chat-screen.tsx` 重画：
  左侧花名册「本线程的 AI 团队 · 6」，点任一行右侧滑出该 agent 的独立对话。截图 `uc-4-3-chat-drawer`。

---

## 错误 2 · 组员私聊默认值画反了——原型是「开 · 必留」，v1 写成 `false`

- **v1 做了什么**：`chat-screen.tsx:21` `const memberChatEnabled = false;`，注释「组员默认不可私聊（由引导师逐场开关）」。
- **为什么错**：原型能力表把「与 AI 的对话」的默认写成 **开 · 必留**，用途是「本组共享推演，**组员私聊汇总在这**」——
  组员默认**可**私聊，且私聊必留档汇总。v1 恰好写反。
- **原型证据**（偏移 **16609949**）：
  - 能力表行：`能力 = 与 AI 的对话` / `组员用它做什么 = 本组共享推演，组员私聊汇总在这` / `默认 = 开 · 必留`
- **v2 修正**：`MEMBER_CHAT_DEFAULT_ON = true` + `MEMBER_CHAT_META`；chat 屏顶部显式渲染「与 AI 的对话 · 默认 开·必留」策略条。
  观察者仍无入口（只读）。截图 `uc-4-3-chat-member`（组员视角可私聊）。

---

## 错误 3 · 单个 agent 私聊的抽屉细节缺失——skill 清单 / 快捷追问 / 专属占位符 / 往返

- **v1 做了什么**：单 Ava 面板有 skill 清单与转出，但没有 agent 切换、没有各 agent 专属的 quick / 占位符 / 往返对话。
- **原型证据**（抽屉结构，偏移 16720000–16725800）：
  - 抽屉：右侧滑出 400px，头部 `ab / name / model` + 关闭 ×；skill 清单 chips；往返消息（左 agent / 右本人）；
    快捷追问 pill；`<textarea placeholder="{{agentCur.ph}}">`；注脚「只和这个 agent 单聊，不进主线程」；发送。
  - 每 agent 专属占位符：`只问 Ava：这条假设怎么验？` / `只问 Atlas：这个流程哪里最浪费？` /
    `只问 Scout：这个数字有出处吗？` / `只问 Ledger：换个假设会怎样？` / `只问 Warden：这样做合规吗？` / `只问 Echo：他们原话怎么说的？`
- **v2 修正**：`ChatDrawer` 组件按原型逐字复刻——每 agent 各自的 skills/quick/lines/占位符/model 从 `AGENT_CHAT_ROSTER` 读。
  保留 v1 已做对的「转出到主线程带出处」（agent 版本 + skill 版本 + 数据来源）。截图 `uc-4-3-chat-transfer-provenance`。

---

## 我在 16.60–17.05M 数据区里多看到、但本轮未纳入的东西（如实说，交人类判断）

- **主动插话开关**：`AG` 每个 agent 的 `model` 串里带「主动插话 开 / 被动·仅被 @ 时出现」（Ava/Scout/Warden 开、Echo 被动）。
  这与 `PROJECT_AI_SWITCHES.pa-propose`（Facilitator 主动提议收敛）是同一件事的 agent 级投影，v2 的花名册用在场态呈现了，
  但**逐 agent 的主动插话开关 UI** 未画（团队编排屏 `team-screen` 是它更合适的落点）。
- **能力表其余行**（偏移 16609949 起同表）：`用户访谈（访谈 AI 代跑并回流转写·开）` / `深度研究（带出处的分路检索·开）` /
  `用户研究（概念测试与可用性回合·关·两天档才开）`——这是**项目级 AI 能力开关**的完整清单，比 v1 `PROJECT_AI_SWITCHES` 的三条更全。
  本轮聚焦私聊，未重画团队编排屏；**建议把这张能力表补进 `team-screen` 的项目级开关**（下一轮）。
- **Ledger「跑批中·需批准」**：花名册里 Ledger 在场态是「跑批中」，与批准卡（`routing`/`APPROVAL_CARD`）联动——
  私聊屏只呈现在场态，未做「私聊里触发需批准动作」的联动，属跨屏，未画。

---

## 可复用而 v2 沿用的

- **非私聊五屏**（三层权限 / MCP 安全策略 / 机密路由 / AI 团队编排 / 行为审计）v1 做得对，v2 **原样复制进 v2 目录**、未改。
- **转出带出处**（agent 版本 + skill 版本 + 时间 + 数据来源）v1 已做对，v2 沿用 `PRIVATE_CHAT.transferProvenance`。
- **RuntimeShell 七态 + 视角切换器**沿用。
