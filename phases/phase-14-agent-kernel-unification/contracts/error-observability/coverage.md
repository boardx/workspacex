# 契约束 `error-observability` — UC 覆盖证明（支撑材料）

> R12 验收线索来自 `requirements/05-error-observability.md#R12`（单一事实源）。

## 一、R12 → API → 前端消费点

| V | 一句话（R12 原文对应） | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 固化模型调用失败注入回归测试，断言分类不再误标 | `getRunFailure`（`FailureCode`） | `agent-kernel-error-card` | ✅ 契约闭合 |
| V2 | 遍历所有已定义错误码，确认均有 `suggestedAction` 映射 | 无独立 API（`FAILURE_CODE_SUGGESTED_ACTIONS` 静态映射验收） | —（契约测试遍历，非运行时前端） | ✅ 契约闭合 |
| V3 | `failed` 展示区不得出现未转换错误码/堆栈，仅折叠区可见 | `getRunFailure` | `agent-kernel-error-message` / `agent-kernel-error-details` | ✅ 契约闭合 |
| V4 | 有权限角色可读取完整 prompt/response 内容，无权限角色被正确拒绝 | `getRunTranscript` | —（审计接口，无前端 UI，R8 已如实标注缺口） | ✅ 契约闭合 |

## 二、API → 判据（反向）

| API 操作 | 被哪条 R12 需要 |
|---|---|
| `getRunFailure` | V1 V3 |
| `getRunTranscript` | V4 |

无孤儿操作：两个操作均能追溯到 R12 验收线索。
