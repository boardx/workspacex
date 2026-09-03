---
status: confirmed
bundle: chat-persona-roundtrip
base_bundle: chat
scope: persona-summary-signoff-plus-trigger-plus-diagram-save-readback
covers: []
confirmed_by: usamshen
confirmed_at: 2026-08-18
---

# Design delta 签核 · chat 用户画像生成与图表保存读回闭环（G1+G2）

⚠ `status`、`confirmed_by`、`confirmed_at` 只能由人类修改；agent 不代签。

本 delta 挂靠已经确认的 `chat` 束（`phases/phase-01-run-a-project/contracts/chat/`），
背景是人类 2026-08-18 真机验证过的端到端场景（后台开 persona 新版 → chat 生成画像并
渲染 → 最大化编辑保存 → 退出重进看到保存版）中的两个缺口：G1 保存后无读回路径、
G2 `summarizePersonaFromThread` 待补签且零触发点。产出材料**均未落代码**——
`packages/contracts/src/chat.ts` 分文不动。人类可以逐件独立勾选签核。

## ① UI

请评审 [contract.md](./contract.md) 第一节。无原型截图工具，材料用文字描述交互流程，
供人类判断是否需要在正式实现前补一版真实原型截图（`ui-prototyper`）。

重点确认：

- 「生成用户画像」触发入口三个候选落点（A composer 状态条 / B per-message 工具栏 /
  C 右栏产物面板）选哪个——材料推荐 A，理由见 1.1 节；
- 读回提示交互：「已加载你 X 时间前保存的版本」提示条 + 「回到原始版本」出口的形式
  是否符合预期（材料的硬约束是**不静默替换**，用户任何时刻能分辨原始/编辑版）；
- 别人的草稿读不到时是否提示「有你看不到的草稿版本」（材料默认不提示，见 1.3 节）。

## ② 用例

请评审 [contract.md](./contract.md) 第二节的用例表，重点看**失败模式是否穷举**：

- 信息不足（空线程）是落「信息不足」占位还是直接拒绝（C_CHAT_11 原登记问题之一，
  材料推荐落占位）；
- 同一消息多次保存产生多个 draft 行：维持不去重（读回按最新、历史留审计）还是收敛为
  覆盖式单草稿（材料默认不去重，不改 `landAsArtifact` 语义）。

## ③ API 契约

请评审 [contract.md](./contract.md) 第三节。当前只确认设计边界，不修改
`packages/contracts/src/chat.ts`；签核后由实现 feature 把 Zod schema 落入该契约单源。

特别需要确认：

1. **G2 产出形态取舍**（contract.md 1.2 节，本材料最大取舍）：方案甲 ```mermaid
   mindmap 围栏（复用现有渲染/最大化/编辑/保存全通道，零白名单改动）vs 方案乙
   ```persona 围栏 + 扩展 chat 渲染白名单（形态更同构但改动面大得多）——材料推荐甲。
2. **G1a `messageId` 可空语义**：`listThreadArtifacts` 条目的 `messageId` 签
   `z.string()`（严格，今天全部行都有值）还是 `z.string().nullable()`（为未来非
   landing 来源的行预留）——材料列出 nullable 草案但指出严格版承诺面更小。
3. **G1b `getThreadArtifactSource`**：路径、out 形状（`markdown/version/savedAt/savedBy`）、
   err 是只有 `NOT_VISIBLE` 还是加 `STORAGE_UNAVAILABLE`（材料建议加，见 3.2 节）；
   多次落地取最新是否需要契约层暴露版本选择（材料默认不暴露）。
4. **G2 补签**（C_CHAT_11）：`summarizePersonaFromThread` 按现状形状签核，外加
   `out.resultMessageId` 追加字段与「产出以 assistant 消息进入线程、正文为 mindmap
   围栏」的行为约定；mode 恒 draft 维持（C_CHAT_11 的 live/pinned 开放问题一并裁）。

## 支撑材料

本 delta 未新增 `domain.md` / `coverage.md`——两件事均挂靠已签核的 `chat` 束，未引入
新的领域不变量（I-33/I-36/D-38 均为既有不变量的延续，见 contract.md 3.4 交叉检查）。
若签核认为需要独立支撑材料，请在下方「人类决定」注明，由后续 delta 补齐。

## 人类决定

人类 2026-08-18 在会话中对照逐条列出的裁决草稿确认（原话「confirm了，继续开发」，
frontmatter 的 `status/confirmed_by/confirmed_at` 由人类亲手改定）；本节由 agent
**誊写**该次确认的具体选项，不含任何 agent 代裁的新决定：

- [x] ① 触发入口落点：**A（composer 状态条）**
- [x] ① 读回提示条 + 「回到原始版本」交互：通过（硬约束保留：不静默替换）
- [x] ① 他人草稿不可见时**不提示**存在性（守 I-36）
- [x] ② 信息不足：**落「信息不足」占位**，不拒绝
- [x] ② 多次保存：**不去重**（读回按最新，历史留审计）
- [x] ③ G2 产出形态：**方案甲 mermaid mindmap 围栏**（复用现有全通道，零白名单改动）
- [x] ③ `messageId`：**严格 `z.string()`**（今天全部行都有值；未来真出现非 landing
      来源的行，届时走一次正式契约改动——宽类型提前把缺口盖住正是本仓要防的形状）
- [x] ③ `getThreadArtifactSource` err **加 `STORAGE_UNAVAILABLE`**
- [x] ③ `summarizePersonaFromThread` 按现状补签 + `out.resultMessageId` + mode 恒 draft，通过
- [x] 全部通过，`status` 已由人类改为 `confirmed`

## 追加：2026-09-03 人类直接撤回「① 触发入口落点：A」

人类（usamshen）在直接会话中原话「composer上方的左边的生成用户画像，一直固定在那个
位置，是错误的，请移除这个功能，占据了完整的一行」——撤回上面「人类决定」第一条选定
的候选 A（composer 状态条恒定按钮）。`chat-live-message-panel.tsx` 的
`chat-persona-summary-trigger` 按钮已移除，详见 `verification.md` 对应小节的撤回说明。

⚠ 只撤回入口落点这一件；①/②/③ 其余各条裁决（读回提示交互、信息不足占位、mermaid
mindmap 产出形态、契约字段）未受影响，`summarizePersonaFromThread` 端点保留——本条
是 agent 誊写这次直接撤回指示，不代人类重签整份 delta，`status`/`confirmed_by`/
`confirmed_at` 三个 frontmatter 字段维持原值不动。
