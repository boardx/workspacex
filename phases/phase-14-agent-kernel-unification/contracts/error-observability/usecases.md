# 契约束 `error-observability` — ② 用例接口与失败模式（签核面第 ② 件）

> 洋葱中层，只依赖 `domain.md`。翻译自 `requirements/05-error-observability.md`
> R3/R3'/R4/R5，不发挥。对应 `packages/contracts/src/error-observability.ts`。

## 统一失败枚举

```
GetRunTranscriptError
  FORBIDDEN        仅限运维/开发角色；普通用户不能访问其他用户 run 的完整 transcript
  RUN_NOT_FOUND     runId 不存在
```

`getRunFailure` 复用上游 `chat`/`identity` 的可见性判定，不新增独立错误码
（本人可见自己发起的 run 的错误信息，沿用现有权限范围，R5）。

## UC-1 `getRunFailure` —— 读取人性化错误结构

```
in:  { runId }
out: HumanizedError
pre: 调用者是该 run 的发起者（沿用现有权限范围，R5）
err: NOT_VISIBLE（委托上游判定，本束不重复定义）
```

失败模式：
- run 未失败（不处于 `failed` 终态）时调用本操作的行为未在需求原文中定义——
  **待人类在签核时确认**：应返回 404 语义的错误，还是允许提前查询返回一个
  "尚无失败信息"的空态。当前契约的 `out` 是必填的 `HumanizedError`，暗示调用方
  应只在 `failed` 态才调用，但这个前置条件未在 `err` 枚举里机械体现。

## UC-2 `getRunTranscript` —— 审计接口读取完整 transcript

```
in:  { runId }
out: { runId, steps: TranscriptStep[] }
pre: 调用者具备运维/开发角色（复用现有组织内权限体系，R5）
err: FORBIDDEN | RUN_NOT_FOUND
```

失败模式：
- `FORBIDDEN`：无权限角色被正确拒绝访问（R12 验收线索）。这条判定与
  `getRunFailure`（run 发起者本人可见错误卡片与"查看详情"）是两个独立的可见性
  判定，不可互相替代（domain.md I-5）。
- `RUN_NOT_FOUND`：runId 不存在。是否需要与 `FORBIDDEN` 合并为同一个不可区分
  的出口（避免成为"run-id 是否存在"的探针，参考 `wave2-runtime.ts`
  `AGENT_RUN_NOT_VISIBLE` 的先例做法）——**待人类在签核时确认**是否要采用同样
  的收窄处理，本轮契约暂时保留两个独立错误码以便审计接口本身给出更精确的
  排障信息（审计接口的调用者本就是可信角色，探针风险低于普通用户可见接口）。

## 跨束委托（不在本束实现，只调用）

- run 发起者身份/可见性判定 → 上游 `chat`/`identity` 束。
- 触发 `HumanizedError` 产生的错误来源（模型调用/沙箱执行）→ `kernel-gateway` 束
  `proxyToolExecution` 的 `error` 字段是分类的第一现场，本束的 `FailureCode` 在其
  基础上做进一步归类（该分工待人类在 `kernel-gateway/domain.md` 处一并确认）。
- run 失败事件的推送时机 → `streaming-transport` 束的 `status_change` 事件
  （携带 `status: "failed"`），`HumanizedError` 在该事件推送时同步产出（R9）。
