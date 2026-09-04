# 契约束 `plan-permissions` — UC 覆盖证明（支撑材料）

> R12 验收线索来自 `requirements/03-plan-mode-permissions.md#R12`（单一事实源）。

## 一、R12 → API → 前端消费点

| V | 一句话（R12 原文对应） | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 非平凡任务第一个可见状态必须是 `awaiting_plan_confirmation` | `getPlan` | `agent-kernel-plan-confirmation-card` | ✅ 契约闭合 |
| V2 | 编辑 todo 后确认，实际执行路径反映编辑内容（非仅 UI 显示） | `editPlanStep`/`deletePlanStep` → `confirmPlan` | `agent-kernel-plan-step`（`-edit`/`-delete`） | ✅ 契约闭合 |
| V3 | 固定测试场景下计划确认次数不超过预期上限（I-2） | `confirmPlan` | —（次数计数，API 层验收） | ✅ 契约闭合 |
| V4 | 纯只读任务全程不出现 `awaiting_tool_permission` | `getPlan`（L0 步骤不触发 `decideToolPermission`） | —（反证，API 层验收） | ✅ 契约闭合 |
| V5 | 含 `bash_exec` 任务未授权时必进入确认态，拒绝后不得继续执行 | `decideToolPermission`（`deny` 分支） | `agent-kernel-tool-permission-dialog` | ✅ 契约闭合 |
| V6 | 分别验证单次/本 run/以后三档授权生效范围（以后需验证跨 run 持久化） | `decideToolPermission`（`StandingToolGrant`） | `agent-kernel-tool-permission-{once,run,forever,deny}` | ✅ 契约闭合 |
| V7 | 代码库中不再存在 `awaiting_approval` 独立状态分支 | 无 API（静态扫描验收，`streaming-transport` 束 I-5） | —（静态扫描） | ✅ 契约闭合 |

## 二、API → 判据（反向）

| API 操作 | 被哪条 R12 需要 |
|---|---|
| `getPlan` | V1 V4 |
| `editPlanStep` | V2 |
| `deletePlanStep` | V2 |
| `confirmPlan` | V2 V3 |
| `cancelPlan` | R4 A1（取消流程，原文未编 V 号，补记） |
| `decideToolPermission` | V5 V6 |

无孤儿操作：`cancelPlan` 对应 R4 A1 的取消场景，原文散文式表述未编号，此处补记
其对应关系，不代表接口多余。
