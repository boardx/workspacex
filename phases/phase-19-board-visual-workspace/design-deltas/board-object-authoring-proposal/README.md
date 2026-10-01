# Board 对象创作设计提案（待人类确认）

此目录是 S02 的候选设计材料，位于正式 `contracts/` 之外。它不扩展已由人类确认的 S01 一致性复核范围，不解锁 BV04–BV06；三项设计签核与增量跨束复核均保持 pending。

- [UI 与八态 Fabric 预览](ui.md)
- [用例](usecases.md)、[领域边界](domain.md)、[覆盖矩阵](coverage.md)
- [待确认清单](design-signoff.md)、[增量跨束审查](design-coherence-review.md)

相关候选：[PR #4722](https://github.com/boardx/workspacex/pull/4722) 的 `board-authoring-contract-draft` 是另一份未签核方案，聚焦 BV04/BV05 的 DOM mock 与 sizing/100-sticky 边界。本提案使用真实 Fabric 原型，并涵盖 BV06 Reaction/Link Preview 与 500-sticky 目标。两者均未成为权威；人类需要选择并解决 sizing、bulk limit 和权限边界差异，之后再将确认方案移入正式 contracts。此 PR 不合并或改写 #4722 的 draft。

材料追踪：Closes #4847；实现关联：Refs #4032。
