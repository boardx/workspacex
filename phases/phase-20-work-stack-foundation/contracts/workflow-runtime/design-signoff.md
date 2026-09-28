---
bundle: workflow-runtime
phase: "20"
covers: [WF01, WF02, WF03, WF04, WF05, WF06, WF07, WF08]
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-09-27T16:30:00Z"
confirmed_via: "人类在 GitHub 亲自签核"
---

# 契约束 `workflow-runtime` 设计签核

> 签核状态只由人类填写（ADR-023 决策五）。2026-09-28 人类授权「先执行、后补签」：
> 本束 feature 可先开发，但 `status` 保持 `pending`，agent 不写 `confirmed_by` / `confirmed_at`。

覆盖意图（派生视图；权威是 frontmatter `covers:`）：

| feature | 能力边界 |
|---|---|
| WF01 | Definition/Version/Instance 领域模型、ports、发布校验与版本固定 |
| WF02 | 唯一 checkpointer 工厂（`langgraph_workflow`）、统一 receipt、epoch CAS lease |
| WF03 | start / resume / cancel API、事件日志、SSE 信封、演示 Workflow |
| WF04 | effect-gateway：执行前权限重查、effect receipt、provenance、不重放对账 |
| WF05 | 人工门 approve / deny |
| WF06 | pg-boss 泛化与 webhook 触发（HMAC + 幂等键） |
| WF07 | 引导式研究迁移到通用 Runtime（Stage 1） |
| WF08 | Workflow 运行面板与审批 UI |

依据：`requirements/02-workflow-runtime.md` R1–R12；ADR-118 第 1–9 条；ADR-116 第 3 条；ADR-120 第 1–3 条；
`docs/proposals/PROP-WORK-STACK-001.md` 修订 R1。

## 一、材料清单

- ① UI：`ui.md`（运行面板 + 审批抽屉；截图 `ui-preview/workflow-runtime/run-panel.png`，七态逐条列出）。
- ② 用例：`usecases.md`（UC-WR-1～UC-WR-13 对外 + 4 个内部端口用例，失败模式穷举）。
- ③ API 契约：`packages/contracts/src/workflow-runtime.ts`（zod 单源；`workflowRuntime` 13 个 operations、SSE 信封、封闭枚举）。
- 支撑·领域模型：`domain.md`（I-1～I-18）。
- 支撑·覆盖证明：`coverage.md`（V1～V16 双向核对）。

## ① UI — 人看到的界面对不对

- [ ] 入口：Agent 详情 / 对话页「运行 Workflow」只列白名单内可运行 Workflow；无运行权限用户看不到入口。
- [ ] 运行面板：阶段时间线（状态 / attempt / 固定 Skill 版本）、固定版本徽标、SSE 实时日志、产出链接、取消 / 从该阶段重试。
- [ ] 七种态：运行中 / 等待审批 / 被拒 / 权限阻断 / 断线重连 / 失败可重试 / 空列表，是否都有明确呈现。
- [ ] 审批抽屉：副作用预览（能力分类、目标系统、摘要）、发起人与 Agent、批准 / 拒绝（必填理由）；已决定只读。
- [ ] `research-studio` 外观不变（迁移只换后端）。

## ② 用例 — 业务流程对不对

- [ ] 发布即不可变；在跑实例固定 definition 与 Skill 版本，v2 只作用于新实例。
- [ ] 副作用一律经 effect-gateway，审批通过后执行前仍重查权限；begin 未 finalize 永不盲目重放。
- [ ] 审批：第一个有效决定生效；默认不能自批；管理员不能代批（除非被门列为审批人）。
- [ ] 他组织 / 无关成员看实例一律 404。
- [ ] 失败模式清单是否穷举（见 usecases.md 每个 UC 的 `err`）。

## ③ API 契约 — 接口形状对不对

- [ ] 路径与方法：`POST /workflows/{key}/instances`、`POST /workflow-triggers/{triggerId}/webhook` 等 13 个操作。
- [ ] SSE 信封 `{instanceId, seq, type: snapshot|delta, stateVersion, payload}`。
- [ ] `WorkflowErrorCode`（HTTP）与 `WorkflowReasonCode`（运行中阻断）两个封闭枚举的成员是否够用、是否多余。
- [ ] `state_version_conflict` 必带 `latestProjection`；`gate_already_decided` 带 `decidedGate`。

## 待签核人裁决的开放问题

见 `usecases.md` 末节「开放问题 Q1–Q6」。
