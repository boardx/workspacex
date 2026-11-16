---
status: pending-human-review
scope: aidt-native-run-context
---
# AIDT 原生 Agent 上下文：设计与本轮批准记录

**本束方案A已获下述真实会话批准，正在按限定范围实现。** frontmatter保留原pending，不由Agent代签个人审批状态；不授权生产部署、模型额外调用或权限变更。

## 要解决的实际问题

真实 S1 运行 `17281977-6dc2-4797-a4c2-53953d978908` 已挂 `aidt-understand`，但 `confirm_task_intent` 将第一步误称共情/empathize。学生在同一运行中编辑理解后继续成功；这证明人可纠正，不能证明模型自动判断正确。

已复现软件缺陷：原生 SDK 将 `useAgentContext` 放入 AG-UI `context`；API 桥目前只抽最后一句 user text，教学阶段与已存材料没有从该入口继续传给运行。无网络真实 controller 反例准确失败。原生 Skill pins 仍存在，未捕获完整供应商 prompt，因此不把全部错识因果都归给这个丢失点。

## 同束三件

| 人类审阅项 | 具体材料 | 当前决定 |
| --- | --- | --- |
| ① UI | [ui.md](ui.md)：原生 Chat、只读来源回执、失败重试、学生主动发送 | 本轮会话批准，实施验证中 |
| ② 用例 | [usecases.md](usecases.md)：阶段/返工/SUM、精确历史、幂等/resume、隔离和失败反例 | 本轮会话批准，实施验证中 |
| ③ API、持久化与模型边界 | [api-design.md](api-design.md)：命名 selector、2 张仅AIDT表（不可变快照+追加应用记录）、1 个 AIDT 回执 GET、组装/派发状态 | 本轮会话批准，实施验证中 |

## 本轮已批准的最小方案 A

在已有 AG-UI 请求的 `forwardedProps.aidtContext` 中只传 **project、阶段或 SUM、精确已保存版本及可选返工版本**；正文、角色、指令和授权均不从客户端上下文取用。服务端用 principal、实际 Chat thread 和实际挂载 Skill 确认范围，回读本组共享 Stage 的指定修订，冻结为仅 AIDT 的 run snapshot。消息、run 与 snapshot 同事务受理；重试与 resume 不换新 head，不偷偷拼改学生消息。

复用现有 Chat UI，增加通用可选 host 适配口，普通 Chat 不依赖 AIDT。新增仅 AIDT 的只读回执 GET，区分“材料快照已准备”“模型输入已组装”“已向原生 Agent 服务派发”；保存快照不等于模型已收到，更不等于学习完成。既有普通 GET run 响应保持不变。

v1 只纳入服务端已授权的**共享六步稿、指定第6步返工记录、SUM 选定历史修订**。个人检查点/Artifacts 正文不自动接入本快照，界面明确未纳入；不把前端已读正文冒充服务端授权回读。不读取原始文件字节，不转写、不自动保存学生阶段成果，不增加教师点评或验证结论。

## 原提案选项与签核边界（保留历史）

- **A：批准上述最小方案。** 包含本束所列 selector/回执单源契约、独立表、agent_runs内部不可变marker、仅AIDT append-only application journal（不改通用ExecutionEvent闭集）与内部 pipeline 接线，以及对应 UI、隔离和原生验收；具体预算见 API 设计。
- **B：要求修改本束。** 可指出输入来源、回执范围或预算的差异；在修订并获得批准前，核心 pipeline 保持未实现。

本轮下方会话记录已批准A；保留原frontmatter作历史，不代人签字。已有前端六步标题/任务描述修正和无网络反例可保留，不能据此宣称上下文丢失已修复。

签核依据来自根 `AGENTS.md`：“契约束必须经人类签核……签核是人的动作，agent不许改status”。本束增加 run 上下文与持久化契约语义，不能用旧 Files/课程签核替代。原设计提交时核心实现等待这一门；现仅按下方真实批准继续实现，不替人签名。

## 本轮真实会话批准记录

2026-11-16，用户直接回复原文：**“批准上下文桥接方案，继续实现”**。root转达对应async问题 `call_0b5fc90ff2694220a01f6931c6c4d8a8`，覆盖本束UI、用例、selector/receipt API、两张仅AIDT表及运行快照方案A；不扩新范围。未猜测签字人或具体时刻，未修改frontmatter status。下述原设计门已由此真实授权解除；实现和测试结果另记，批准不等于通过验收。
