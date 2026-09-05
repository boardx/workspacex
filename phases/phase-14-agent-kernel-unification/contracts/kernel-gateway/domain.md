# 契约束 `kernel-gateway` — 领域模型与不变量（支撑材料）

> 洋葱最内层，不依赖任何外层。回答的问题：**网关与内核之间的边界在哪里，
> 什么时候算越界。** 翻译自 `requirements/01-kernel-unification.md`。

## 一、实体与值对象

### `KernelForwardedRun`（转发记录，非持久实体，逻辑概念）

```
KernelForwardedRun {
  runId:            string
  threadId:         string
  messageId:        string
  kernelSessionId:  string   # 内核侧承接该 run 的进程/图执行标识
}
```

一次 `forwardRun` 调用即产生一条逻辑上的转发关系：网关把 run 的执行责任移交给
内核，自己只保留鉴权/账本旁路/事件转发三项职责（R3 步骤 7）。

### `ProxiedToolCall`（代理执行记录）

```
ProxiedToolCall {
  runId:        string
  toolCallId:   string
  toolName:     string
  args:         object      # 完整入参
  result:       unknown | null
  ok:           boolean
  error:        ProxyToolExecutionError | null
}
```

## 二、不变量

- **I-1 单一执行内核**：`apps/api` 代码库中不存在任何独立的规划/工具循环实现
  （R6 后置条件）。可断言：静态扫描 `apps/api/src` 不出现
  `executeToolLoop`/`useLazySkillLoading`/纯 `complete()` 单次调用三条历史分支的符号
  （R4 E3）。
- **I-2 网关是唯一执行权**：内核不得绕过网关直接执行任何有副作用的操作（R5）。
  可断言：`deep-agent-service` 侧代码里，任何标记为有副作用的工具调用路径必须
  经过 `proxyToolExecution` 契约操作，不存在内核直接持有沙箱/文件系统句柄的路径。
- **I-3 快速失败**：内核不可用时网关在下发前做健康检查，不让请求悬挂等超时
  （R4 A1）。可断言：`forwardRun` 在 `checkKernelHealth` 返回 `unavailable` 时
  必须以 `KERNEL_UNAVAILABLE` 立即返回，不发起下游调用。
- **I-4 终态可达**：内核内部执行异常时必须通过 `status_change → failed` 通知网关，
  不允许 run 卡在非终态且无任何执行方在推进（R4 E1）。这条不变量的机械落点在
  `streaming-transport` 束（`isTerminalRunStatus`），本束只保证异常总会被上报。
- **I-5 能力开关默认开启且不作为长期配置存在**（F02，R6）：
  `DEEP_AGENT_REMOVED_FLAG_NAMES` 列出的六个符号，在验证稳定后从代码库物理移除，
  不以"默认关闭的开关"形式保留。可断言：静态扫描 `apps/deep-agent-service` 源码
  不出现这六个符号字面量。

## 三、待人类在签核时确认

- E2（沙箱故障错误分类）与 `error-observability` 束的 `SANDBOX_UNAVAILABLE` 码是否
  完全共用同一个错误码空间，还是本束内部先归一次类再传给 error-observability 束
  转换——两束需求文件都提到该码但未明确谁是分类的"第一落点"，本轮按 R4 E2 原文
  理解为 `kernel-gateway` 侧的 `proxyToolExecution` 是错误产生的第一现场，
  `error-observability` 束的 `toFailure` 在其上游做进一步归类，**这一分工待人类确认**。
