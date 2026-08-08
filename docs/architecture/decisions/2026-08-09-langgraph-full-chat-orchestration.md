# 裁决：LangGraph 扩大为全部 chat 的多步编排层（撤销 #654 的 P4 限制）

> 单一事实源。这份文件**取代** issue #654 里"CopilotKit/AG-UI UI 协议范围扩到通用 chat，
> 但 LangGraph 多步编排仍限 P4"这句话中"仍限 P4"的部分——不要在 `docs/architecture/
> context-engine.md`、`.harness/instructions/architecture.md` 或任何 PR 描述里重新
> 声明这条范围，引用本文件。

## 人类直接指令（原话，2026-08-09）

> 「CopilotKit + LangGraph deep agent，使用这个组合作为全部的 chat 的方案……不要问人类
> 任何问题，你可以根据最佳实践来快速地做决策。」

同日随后确认（面对 #654/#775 字面冲突时的澄清提问）：**"真的要把 LangGraph 扩大到整个
chat 的多步编排层"**——不是"默认 agent 的工具执行换个实现"这种局部范围，是 chat 的
多步编排（多代理协作、流式渲染、工具调用可见性等）整体都以 CopilotKit + LangGraph 为
底座。

## 与 #654 的关系：扩大范围，不是推翻

`#654`（`7033e798` 记录）的两条结论：
1. **CopilotKit/AG-UI 的 UI 协议范围从 P4 扩到通用 chat**——继续有效，本裁决不改这条。
2. **LangGraph 多步编排仍限 P4**——本裁决**撤销**这条限制，扩大为覆盖全部 chat。

## 已有产出不推倒重来——先盘点，能复用的复用

`docs/proposals/PROP-CHAT-COPILOTKIT-LANGGRAPH-001.md`（issue #775）已经点出：本仓
今天已经交付、且方向与本裁决一致的东西，包括但不限于：

- CopilotKit UI 渲染（`@copilotkit/react-ui` 的 `Markdown` 组件，PR #670 起）。
- AG-UI SSE 桥接端点（`POST /copilotkit/agui`，`agui-bridge.ts` + `copilotkit-agui.
  controller.ts`，issue #654 阶段1b + #654 阶段2a/2b/2c/2d 的增量流式）。
- 工具调用可见性（issue #732，前端渲染 `tool_call` run-step）。
- deepagents 服务骨架（issue #739/#743，已在生产 VM 上用真实 `deepagents==0.7.5` +
  真实模型凭据端到端验证：建线程→提交 run→agent 说明意图→调用 `list_org_skills`→
  调用 `call_skill`→给出最终答案，全程真实响应，见 issue #740/#747/#765/#766）。
- 线程内转录卡（`chat-transcript-card`，`message-stream.tsx`）——ambient-bar（issue
  #752）移除时确认的、语义正确的替代实现。

**扩大范围后的工作是"把这些已验证的积木按新的整体方案接起来、补齐缺的那部分"，不是
从零重写。** 任何后续 PR 如果打算删除/重写上述已合并的产出，必须在 PR 描述里说明
为什么复用不可行，不能默认"全新方案=全部推倒"。

## 范围（本次裁决覆盖）

1. **研究最新 LangGraph / `deepagents` 库能力**（不锁定今天已验证的 `deepagents==0.7.5`
   这个版本号本身，允许在实现时用当时的最新稳定版，前提是可复现验证）。
2. 制定 LangGraph（`deepagents` 模式）与 CopilotKit（AG-UI 协议）的整合方案——多代理
   协作、流式渲染、工具调用可见性、消息级上下文等如何统一在这套编排层之上。
3. 端到端实现，**必须能在 devapp 上真实验证**——不是本地/预览环境。
4. 验收标准：`.harness/instructions/chat-ux-acceptance-criteria.md` 十项维度，coord-main
   角色用真实浏览器评分，未达 10/10 持续迭代，达标后再发布（该文件已有的纪律，本裁决
   不新开一套）。

## 不受影响

- `#728`（chat 主屏 UI 与原型的视觉/结构保真度）与本裁决是两件事（保真度 vs 编排架构），
  按 `chat-ux-acceptance-criteria.md` 开头那条"范围边界"说明，两条线独立评分，`#728`
  不因本裁决暂停。
- Deep Research agent、图片生成 agent 两个独立系统 agent 的现有执行路径不受影响。

## 后续动作

- `docs/architecture/context-engine.md`、`.harness/instructions/architecture.md` 里
  "LangGraph 限 P4"的措辞需要回填更新（跟 #684 当时回填 #654 结论是同一件事，本次一并
  登记，具体 PR 见后续实现分支）。
- 迁移/实现按标准 `new-phase`/issue-PR 流程走，不豁免签核（本裁决只解决"要不要扩大范围"
  这个架构问题，不豁免各 feature 自己的契约签核）。
