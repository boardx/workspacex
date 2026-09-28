# ADR-118: 通用 Workflow Runtime

- 状态: Proposed
- 适用层：项目实现（专属）
- 日期: 2026-09-28
- 关联：#4534 · `docs/proposals/PROP-WORK-STACK-001.md` · `requirements/work-stack-v2/`

## 背景
数字访谈（`digital-interview-graph.ts`）和引导式研究各自实现了 LangGraph + PostgresSaver、receipt、lease、SSE、projection；研究的基础设施反向 import 访谈的文件，两者共用 `langgraph_interview` schema；projection 直接读 `channel_values`；图版本只是 state 字段，没有在跑实例的迁移规则。没有 webhook/事件触发，pg-boss 只能唤醒 agent run。

## 决策
1. 新建 `domain|application|infrastructure/workflow/`。ports：DefinitionStore、InstanceStore、ReceiptStore、LeaseStore、EventLog、TriggerStore；用例：publish / start / resume / approve / cancel。
2. **Workflow 用 TypeScript 图工厂定义**，配版本化的 `WorkflowDefinition` 元数据（阶段、每阶段 Skill、工具分类、副作用类别、人工门）。不做通用 DSL 解释器（推迟到 Stage 3）。
3. 统一基础设施：一个 receipt 表（沿用引导式研究的 begin/finalize 形状）、一套 lease、一个 SSE 信封（seq + snapshot/delta + 断点续传）、一个 checkpointer 工厂（独立 schema `langgraph_workflow`，按 `key:version` 分命名空间，共享连接池）。
4. **业务行是事实，checkpoint 只是编排状态**；projection 只读业务行。
5. 实例固定在启动时的版本；新版本只作用于新实例。
6. 外部副作用统一经 `effect-gateway`：执行前重查权限（MCP 副作用封顶 + 授权）→ receipt → provenance。
7. 触发器：pg-boss 泛化为能启动 workflow；新增 webhook 触发（签名校验 + 幂等键）。
8. 迁移证明：Stage 1 迁移引导式研究；Stage 2 迁移数字访谈。

## 后果
- 新 Workflow 不得自建 checkpointer、receipt 或 lease。
- Context Pack 需从「run」泛化到「run 或 workflow stage」。

## 补充决策（2026-09-28，人类裁决，作者化试点评审提出）
9. **Workflow 固定 Skill 版本；负责它的 Agent 不需要另外挂载这些 Skill。** Agent 只要在 `workflowAllowlist` 里被允许运行某 Workflow 版本，就可以在该 Workflow 的阶段内使用它固定的 Skill 版本。Agent 自己的 Skill 挂载（`agent_versions.skill_version_ids`）只管聊天中的直接调用。组合矩阵里 DigitalHuman 行的 Skill 列因此只列「直接调用」的 Skill，不必为了 Workflow 阶段逐个补边。
