# 契约束 `error-observability` — 领域模型与不变量（支撑材料）

> 洋葱最内层。翻译自 `requirements/05-error-observability.md`，不发挥。

## 一、实体与值对象

### `FailureCode`（值对象，稳定分类）

```
MODEL_CALL_FAILED | SANDBOX_UNAVAILABLE | KERNEL_UNRESPONSIVE
USER_CANCELLED | UNKNOWN_EXECUTION_ERROR
```

### `HumanizedError`（聚合，前端错误卡片的唯一数据源）

```
HumanizedError {
  runId:              string
  failureCode:        FailureCode
  message:             string             # 面向用户，主展示区
  suggestedActions:    SuggestedAction[]   # 至少一个，至少覆盖 retry/simplify/contact 三种之一组合
  rawDetails:          { errorCode, stack }  # 折叠区，仅 run 发起者本人可见
}
```

### `TranscriptStep`（完整可审计执行记录）

```
TranscriptStep {
  stepId:          string
  kind:            "model_call" | "tool_call" | "plan_change" | "permission_decision"
  decryptStatus:   "ok" | "unreadable"
  fullContent:     string | null   # decryptStatus="ok" 时非 null，否则为 null
}
```

存储结构从"digest + 截断摘要"改为"完整内容 + 字段级加密"（R6 后置条件）。

## 二、不变量

- **I-1 分类准确优先**：错误分类的准确性优先于"总能给出一个分类"——宁可标记
  `UNKNOWN_EXECUTION_ERROR` 这类诚实的兜底类别，也不能张冠李戴地标成一个具体
  但错误的分类（R7）。可断言：模型调用失败注入（`ModelCallError:
  MODEL_CALL_FAILED`）的分类结果恒为 `MODEL_CALL_FAILED`，绝不落到
  `SANDBOX_UNAVAILABLE`（本 phase 触发 bug 回归用例，E1）。
- **I-2 映射完整**：每个 `FailureCode` 都有明确的 `SuggestedActionKind` 映射，
  可通过契约测试遍历验证无遗漏（R6 后置条件）。可断言：遍历
  `FailureCode.options`，`FAILURE_CODE_SUGGESTED_ACTIONS` 中每一项对应数组
  长度 ≥ 1。
- **I-3 主展示区不泄漏内部信息**：面向用户的错误展示，任何情况下都不得直接
  暴露未转换的内部错误码/堆栈信息在主展示区（R7）。可断言：`HumanizedError.
  message` 字段值不等于且不包含 `rawDetails.errorCode`/`rawDetails.stack` 的
  原始文本。
- **I-4 加密失败诚实报告**：完整 transcript 因字段级加密密钥不可用而无法解密时，
  审计接口明确报告"内容不可读"（`decryptStatus: "unreadable"`），而非静默返回
  空值或报错崩溃（R4 E3）。可断言：`fullContent` 为 `null` 当且仅当
  `decryptStatus === "unreadable"`；`decryptStatus === "ok"` 时 `fullContent`
  非 null。
- **I-5 RBAC 边界**：普通终端用户不能访问其他用户 run 的完整 transcript，
  也不能访问超出"人性化错误卡片"之外的原始技术细节，除非该 run 本身是自己
  发起的（"查看详情"折叠区对发起者本人开放，R5）。可断言：`getRunTranscript`
  对非运维/开发角色恒返回 `FORBIDDEN`，与该 run 是否属于调用者本人无关——
  transcript 审计接口与"查看详情"折叠区是两个不同的可见性判定，前者仅限
  运维/开发角色，后者仅限 run 发起者本人，二者不可互相替代。

## 三、待人类在签核时确认

- E4（单次执行 prompt/response 内容体积过大时的大小上限与截断策略）——需求原文
  明确"具体阈值留待实现阶段技术设计，此处只要求明确定义策略而非默认无限制"，
  本契约的 `TranscriptStep.fullContent` 未定义任何长度上限（`z.string()` 无
  `.max()`），**这是刻意的**：契约层面不预设阈值数字，但工程实现必须有截断策略，
  待人类在签核时确认是否需要在契约里补一个 `truncated: boolean` 标志位。
- 完整 transcript 的字段级加密方案本身（R9："这是需要人类明确签字确认的决策点，
  涉及数据合规变更"）——本束契约只定义了 `decryptStatus`/`fullContent` 这两个
  对外可见的字段，加密算法/密钥管理属于实现细节不在契约面，但**加密方案本身
  的合规性需要人类在本轮签核时单独确认**，不能被"契约字段齐全"掩盖过去。
