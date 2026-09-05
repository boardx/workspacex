# 契约束 `kernel-gateway` — ② 用例接口与失败模式（签核面第 ② 件）

> 洋葱中层，只依赖 `domain.md`。翻译自 `requirements/01-kernel-unification.md`
> R3/R4/R5/R6/R7，不发挥。对应 `packages/contracts/src/kernel-gateway.ts` 的
> `operations`。

## 统一失败枚举

```
KernelGatewayError
  KERNEL_UNAVAILABLE        内核健康检查未过（R4 A1，快速失败不悬挂等超时）
  FORBIDDEN                 鉴权/组织隔离校验未过
  SANDBOX_UNAVAILABLE       沙箱本身故障，区别于模型/内核故障（E2）
  EXECUTION_NOT_PERMITTED   工具调用未被授权（分级逻辑归 plan-permissions 束）
```

## UC-1 `forwardRun` —— 网关转发 run 请求给内核

```
in:  { threadId, messageId, resumeFromCheckpointId }
out: { runId, kernelSessionId }
pre: 调用者对 threadId 有写权（委托上游 chat/identity 束的判定，本束不重复定义）
err: KERNEL_UNAVAILABLE | FORBIDDEN
```

失败模式：
- `KERNEL_UNAVAILABLE`：R4 A1，网关在下发前做健康检查，快速失败，不让请求悬挂
  等超时。前端应展示"服务暂时不可用，请稍后重试"，而不是无限 loading。
- `FORBIDDEN`：鉴权/组织隔离未通过。

## UC-2 `proxyToolExecution` —— 内核请求网关代理执行有副作用工具调用

```
in:  { runId, toolCallId, toolName, args }
out: { toolCallId, ok, result, error }
pre: 调用方是已被网关承接的合法 run（kernelSessionId 有效）
err: SANDBOX_UNAVAILABLE | EXECUTION_NOT_PERMITTED
```

失败模式：
- `SANDBOX_UNAVAILABLE`：沙箱本身故障（E2）。**不得**与模型/内核故障混淆——
  这条不变量是本 phase 的直接触发 bug 之一（00-overview 背景），
  `error-observability` 束的分类修复以此为基准。
- `EXECUTION_NOT_PERMITTED`：该次调用未获授权。授权判断的完整分级逻辑
  （L0/L1/L2）属于 `plan-permissions` 束，本束只消费判断结果并执行/拒绝执行。

## UC-3 `checkKernelHealth` —— 下发前健康检查

```
in:  {}
out: { status: "healthy" | "unavailable" }
pre: 无（网关内部探测）
err: 无（探测本身不失败，只报告状态）
```

## 跨束委托（不在本束实现，只调用）

- 线程可见性/写权判定 → 上游 `chat`/`identity` 束（复用其判定结果，本束不重复定义）。
- 工具风险分级与授权决策 → `plan-permissions` 束（`decideToolPermission` 的结果是
  本束 `EXECUTION_NOT_PERMITTED` 判断的输入）。
- run 状态机迁移（`running`/终态）→ `streaming-transport` 束的 `AgentKernelRunStatus`，
  本束的 `forwardRun`/`proxyToolExecution` 是该状态机的驱动方之一，不重复定义状态本身。
