---
id: WF-005
entity_type: workflow
canonical_name: "Document Review-to-Approval"
domain: shared
status: requirement-ready
implementation_stage: 1
source_strategy: A3
canonical_owner: WorkspaceX
state_model: durable-dag
---

# WF-005 — Document Review-to-Approval

## 1. 目标
把 **Document Review-to-Approval** 实现为 WorkspaceX 原生 Reference Workflow：由 Trigger、状态、Skill 调用、Tool/MCP 调用、Human Gate、Evidence、Retry/Recovery 和 Outcome 组成。Workflow 不复制 n8n/Dify/Coze 的节点实现。

## 2. 触发
- manual：用户在 Chat/Board/Digital Human 中启动；
- event：来自 WorkspaceX Event Model 或已授权 connector 事件；
- schedule：服务端持久化调度；
- condition：只有可审计条件为真时运行。
触发必须带 `actor/org/scope/workflow_version/idempotency_key`。

## 3. 状态机
`created → gathering → running → awaiting_plan_confirmation? → awaiting_tool_permission? → awaiting_human_gate? → verifying → completed | failed | cancelled | paused`
- 所有状态写入 durable event log。
- 续跑必须从 checkpoint 恢复，不创建平行逻辑 run。
- 外部写操作前写入 pending side-effect record。

## 4. 标准阶段
1. Intake：解析 intent、scope、deadline、success criteria。
2. Gather：调用只读 Skills / Tools，形成 Context Pack。
3. Plan：编排 2–6 个 canonical Skills；非平凡任务进入计划确认。
4. Execute：逐阶段执行，遵守每个 Skill 的 input/output contract。
5. Gate：高风险/外部写入/财务法律雇佣类进入 human gate。
6. Verify：验证业务结果、Evidence、外部系统写入回读。
7. Record：更新 Artifact、Decision、Task、Memory candidate 和审计。
8. Notify：只发送用户预先授权的通知。

## 5. Skill / Tool 契约
- Skill 只按 stable id 调用，不按文件路径调用。
- Workflow 只消费 Skill 的结构化 outputs，不解析随意 prose 来决定副作用。
- Tools 通过 Tool Registry/MCP adapters 解析；同类 provider 有多个时由 org policy 或用户选择。
- Tool schema/version 漂移时暂停，不自动猜参数。

## 6. 幂等、重试与恢复
- 每个外部副作用必须有 idempotency key。
- 只读 transient error 可指数退避重试；写操作禁止盲重试。
- denied write 转成 proposal，Workflow 可继续只读分支。
- rollback 优先补偿动作；不可补偿时必须进入 manual-recovery 状态。
- cancel 不宣称撤销已经发生的真实副作用。

## 7. Human Gates
- 计划确认：复杂或跨系统流程。
- Tool permission：L2 / 不可逆 / 高影响操作。
- Domain approval：法律、财务、雇佣、隐私、医疗等。
- Publish/send：面向外部人的内容默认要求确认，除非策略中有预授权。

## 8. Evidence 与可观测性
每个 stage 写：`started_at / ended_at / skill_version / model_profile / tool_snapshot / input_refs / output_refs / approvals / omissions / errors`。
最终 outcome 必须可回放到每个 Skill、Tool、Evidence 和人类决策。

## 9. 开源 / 最佳实践证据
- S1: [anthropics/knowledge-work-plugins](https://github.com/anthropics/knowledge-work-plugins) — license: `Apache-2.0`; role: skill/practice evidence
- S2: [n8n-io/n8n](https://github.com/n8n-io/n8n) — license: `Sustainable Use / fair-code`; role: workflow/control-flow evidence only
- S3: [activepieces/activepieces](https://github.com/activepieces/activepieces) — license: `mixed / verify per path`; role: connector/workflow evidence
- S4: [langgenius/dify](https://github.com/langgenius/dify) — license: `Dify Open Source License`; role: workflow/agent UX evidence

### 采用策略
A3 Cross-platform Rebuild：只提取跨平台工作流的触发、状态、分支、审批、重试、回滚与 connector 语义；不得复制 n8n/Activepieces/Dify/Coze 的平台节点实现，必须映射到 WorkspaceX Workflow Runtime + Tool Registry + MCP/Native adapters。来源：anthropics/knowledge-work-plugins, n8n-io/n8n, activepieces/activepieces, langgenius/dify。

### 开源整合边界
- n8n/Activepieces/Dify/Coze 仅提供 workflow pattern、connector 顺序、branch/retry/HITL 证据。
- 不把外部平台 workflow JSON 作为 WorkspaceX canonical 格式。
- 外部 connector 代码若要复用，必须对具体 package 路径做 license review；否则只实现 adapter contract。

## 10. 当前 WorkspaceX 架构落点
- Phase 14：统一 agent kernel、WS event、checkpoint、permission、artifact、interjection。
- Phase 15：Skill/Model/MCP 固定版本绑定；Workflow 运行必须引用 immutable Skill versions。
- Phase 18：Context Pack 和组织事实，不另造 workflow memory 数据库。
- Phase 19：Workflow 在 Board 上表现为可视 Work Graph；每个 stage 映射可观察节点/状态，但事实源仍是 server event log。
- deep-agent-service：负责 agentic stage；确定性编排建议放独立 Workflow domain/service，不塞进 prompt。
- apps/api：薄网关 + 鉴权 +账本，不实现第二套 orchestrator。

## 11. Eval
- success path；
- tool unavailable；
- permission denied；
- mid-run reconnect；
- duplicate trigger/idempotency；
- retry/timeout；
- partial side effect + recovery；
- stale Skill version；
- locale policy conflict；
- audit replay。
生产 Gate：端到端 outcome 正确 + 无未授权副作用 + 可恢复 + audit 完整。

## 12. 验收标准
- [ ] 同一 trigger/idempotency_key 只产生一个逻辑 execution。
- [ ] 刷新/断线后 5 秒内恢复正确交互状态。
- [ ] denied write 无副作用，且 Workflow 可转 proposal/read-only。
- [ ] 所有 Skill 均绑定 immutable version。
- [ ] 所有 write Tool 有 permission decision + result readback。
- [ ] completed run 可重放出完整 stage/evidence 链。
- [ ] Board 可视状态与服务端 execution 状态一致。
- [ ] 外部 workflow/source strategy 可审计。

> 工程师不得把第三方 workflow runtime 作为隐形第二事实源。
