---
bundle: error-observability
phase: "14"
covers: [F13, F14, F15]
status: pending          # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by: ""
confirmed_at: ""
---

# 契约束 `error-observability` 设计签核

覆盖：F13（错误分类修复）、F14（错误人性化转换层+前端错误状态卡片）、
F15（完整可审计 transcript 存储改造）。判据单一事实源：
`requirements/05-error-observability.md` 的 R3/R3'/R4/R6/R12。

## 一、材料清单

- ① UI：`ui.md`（1 张截图：06 错误状态卡片；F13/F15 无独立界面，已如实标注）。
- ② 用例：`usecases.md`（`getRunFailure`/`getRunTranscript`）。
- ③ API 契约：`packages/contracts/src/error-observability.ts`。
- 支撑·领域模型：`domain.md`（I-1～I-5）。
- 支撑·覆盖证明：`coverage.md`。

## 二、人类签核时请重点核对（本束缺口最多，请优先看）

1. **合规决策点（R9 明确要求人类签字）**：完整 transcript 的字段级加密方案本身
   需要满足现行隐私合规要求——这**不是**一条普通的设计确认项，是需求原文点名
   "涉及数据合规变更"的正式决策点，请单独确认，不要与其它常规核对项一起带过。
2. **②失败模式**：`getRunFailure` 在 run 未失败时调用的行为未定义（`usecases.md`
   已标注待确认）；`getRunTranscript` 的 `FORBIDDEN`/`RUN_NOT_FOUND` 是否要收窄
   为单一出口（避免 run-id 存在性探针）——两处都需要裁决。
3. **③API 契约**：`TranscriptStep.fullContent` 未设长度上限是刻意的契约层决策
   （E4 阈值留待实现阶段），`domain.md` 已提出是否需要补 `truncated` 标志位，
   请确认取舍。
4. **不变量**：I-1（分类准确优先于兜底）是本 phase 的直接触发 bug 修复目标，
   请重点核对 `FailureCode` 枚举与 `FAILURE_CODE_SUGGESTED_ACTIONS` 映射是否
   真的覆盖了需求原文列出的场景（模型/沙箱/内核无响应/用户取消/未知）。
5. **kernel-gateway 束交叉引用**：`usecases.md` 提出"沙箱错误分类的第一现场在
   kernel-gateway 束还是本束"这个分工问题，两束 domain.md 都留了相同的待确认段，
   **这是一条跨束交叉约束，请在阶段一致性复核阶段统一裁决，不要在两束各自签出
   不一致的结论**。
