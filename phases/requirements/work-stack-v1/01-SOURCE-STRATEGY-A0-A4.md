# WorkspaceX Work Stack v1 — A0–A4 来源/转化策略

本文件是 320 个实体 requirement 的统一来源策略；实体文件只选择其中一个 strategy，不自行发明第六种。

## A0 Direct Adopt
条件：artifact 级许可证允许商业复用；immutable SHA 可固定；内容/代码质量达标；WorkspaceX 运行时契约可直接适配。
操作：逐文件 license → pin SHA → 保留 NOTICE/attribution → 进入 Skill Studio draft → Eval → immutable publish。
禁止：拿 repo 根 LICENSE 代替 artifact 许可证核对。

## A1 Best-of Merge
条件：多个来源完成相同 job-to-be-done，存在不同优点。
操作：建立 practice matrix（步骤/规则/输出/护栏/验证）→ 逐栏选择最强做法 → 重写 canonical WorkspaceX entity → 记录所有来源 provenance。
禁止：简单拼接多个 SKILL.md，造成重复规则和 vendor 泄漏。

## A2 Clean-room Rewrite
条件：受限/不清晰许可证；法域/专业责任强；第三方表达不能直接复用。
操作：Researcher 只输出抽象需求/流程事实/公共知识 → Author 不接触 protected expression → WorkspaceX 从零实现 → 法务/领域 reviewer 签核。
禁止：paraphrase 源文件当“重写”。

## A3 Cross-platform Rebuild
条件：最佳实践来自 n8n/Activepieces/Dify/Coze 等异构 runtime/workflow。
操作：抽取 trigger/state/branch/gate/retry/rollback/connector semantics → 映射 WorkspaceX Skill/Workflow/Tool Registry → 原生实现。
禁止：把第三方 workflow JSON/node model 作为 WorkspaceX canonical 格式。

## A4 Reject / Archive
条件：许可证失败、来源不可信、ICP 不匹配、重复无独特价值、风险不可控。
操作：保留 evidence/provenance + reject reason；不进入 active catalog，不被 Digital Human 挂载。
