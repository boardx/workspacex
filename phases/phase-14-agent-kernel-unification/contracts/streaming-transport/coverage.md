# 契约束 `streaming-transport` — UC 覆盖证明（支撑材料）

> R12 验收线索来自 `requirements/02-streaming-transport.md#R12`（单一事实源）。

## 一、R12 → API → 前端消费点

| V | 一句话（R12 原文对应） | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 注入已知时间戳事件，端到端延迟 < 500ms | `subscribeRunEvents` | `agent-kernel-progress-stream` | ✅ 契约闭合 |
| V2 | 静态检查确认轮询相关代码已删除（I-2） | 无 API（静态扫描验收） | —（静态扫描，非运行时前端） | ✅ 契约闭合 |
| V3 | 四种非终态各自渲染对应 UI 而非无限 loading | `subscribeRunEvents` 的 `status_change` 事件 | `paused-user` / `paused-system` / `agent-kernel-tool-permission-dialog`（plan-permissions 束）/ `agent-kernel-plan-confirmation-card`（plan-permissions 束） | ✅ 契约闭合 |
| V4 | 本 phase 触发 bug 回归：`awaiting_tool_permission` 刷新后 5 秒内渲染审批 UI | `subscribeRunEvents`（重连补发） | `agent-kernel-tool-permission-dialog`（plan-permissions 束） | ✅ 契约闭合 |
| V5 | 模拟断连恢复，事件序列一致（不丢不重复） | `subscribeRunEvents` 的 `lastKnownSeq` 补发机制 | `reconnect-toast` | ✅ 契约闭合 |

## 二、API → 判据（反向）

| API 操作 | 被哪条 R12 需要 |
|---|---|
| `subscribeRunEvents` | V1 V3 V4 V5 |
| `listRunAttemptsForMessage` | F05 的 R12（一逻辑 run 多次续跑仍映射同一消息）——原文未编 V 号，此处补记：一个用户消息触发的任务需要多次续跑时，不因"一条消息只能对应一个 run"的旧约束而无法表达 |

无孤儿操作：两个操作均能追溯到 R12 验收线索或明确编号之外但原文写明的验收句。
