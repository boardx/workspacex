# 契约束 `kernel-gateway` — UC 覆盖证明（支撑材料）

> 两个方向都查：**判据 → API**（验收线索找不到对应 API ⇒ 接口不够）；
> **API → 判据**（有 API 没人要 ⇒ 接口多余或有判据没写）。R12 验收线索来自
> `requirements/01-kernel-unification.md#R12`（单一事实源，本文件只引用不重抄）。

## 一、R12 → API → 前端消费点

| V | 一句话（R12 原文对应） | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | `apps/api` 静态扫描不存在独立规划/工具循环符号 | `forwardRun`（R6 后置条件的机制载体） | —（静态扫描验收，非运行时前端） | ✅ 契约闭合 |
| V2 | `execute-run.ts` 行数对比改造前显著下降 | `forwardRun` | —（代码行数验收，非前端） | ✅ 契约闭合 |
| V3 | `deep-agent-service` 六个开关默认开启且无用户可感知行为倒退 | 无独立 API（开关是部署配置，非运行时契约面） | `agent-kernel-progress-stream`（streaming-transport 束，用户侧感知点） | ✅ 契约闭合 |
| V4 | 端到端跑一个真实任务，全链路经网关转发到内核执行并正确回传 | `forwardRun` → `proxyToolExecution` → streaming-transport 束事件流 | `agent-kernel-progress-stream` | ✅ 契约闭合 |
| V5 | 内核不可用时快速失败（R4 A1） | `checkKernelHealth` → `forwardRun` 的 `KERNEL_UNAVAILABLE` | —（API 层验收，用户侧表现为 error-observability 束的错误卡片） | ✅ 契约闭合 |
| V6 | 沙箱故障错误分类准确，不与内核/模型错误混淆（E2） | `proxyToolExecution` 的 `SANDBOX_UNAVAILABLE` | `agent-kernel-error-card`（error-observability 束消费点） | ✅ 契约闭合 |

## 二、API → 判据（反向）

| API 操作 | 被哪条 R12 需要 |
|---|---|
| `forwardRun` | V1 V2 V4 V5 |
| `proxyToolExecution` | V4 V6 |
| `checkKernelHealth` | V5 |

无孤儿操作：三个操作均能追溯到至少一条 R12 验收线索。
