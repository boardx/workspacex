# 契约束 `artifacts-steering` — UC 覆盖证明（支撑材料）

> R12 验收线索来自 `requirements/04-artifacts-steering.md#R12`（单一事实源）。

## 一、R12 → API → 前端消费点

| V | 一句话（R12 原文对应） | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 连续两次"继续修改"后版本历史长度正确递增，各版本可独立回看 | `continueArtifact` → `listArtifactVersions` | `agent-kernel-artifacts-panel`（含 `-version-{n}`） | ✅ 契约闭合 |
| V2 | 具体用例（如改标题）断言仅目标部分变化而非从零重新生成 | `continueArtifact` | `agent-kernel-artifact-continue` | ✅ 契约闭合（生成粒度是内核实现细节，本束只保证 `instruction`/`basedOnVersion` 完整传递） |
| V3 | `running` 状态下输入框非 disabled | 无独立 API（前端状态断言） | `agent-kernel-interjection-input`（`disabled={false}`） | ✅ 契约闭合 |
| V4 | 插话后下一步执行路径需体现新指令（用具体场景断言最终产出） | `interject` | `agent-kernel-interjection-input` | ✅ 契约闭合 |
| V5 | 发送插话后 1 秒内显示"已收到"确认 | `interject` 的 `receivedAt` | `agent-kernel-interjection-ack` | ✅ 契约闭合 |

## 二、API → 判据（反向）

| API 操作 | 被哪条 R12 需要 |
|---|---|
| `getArtifact` | V1（读取前置，原文未单独编号，为 V1 的必要前置操作） |
| `listArtifactVersions` | V1 |
| `continueArtifact` | V1 V2 |
| `interject` | V4 V5 |

无孤儿操作：`getArtifact` 虽未被 R12 单独编号，但是 V1"各版本可独立回看"验收的
必要前置读操作，不属于多余接口。
