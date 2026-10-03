# S064 来源与变更记录

## 恢复来源

恢复自 WorkspaceX `requirements/work-stack-v2/skills/S064-problem-framing.md` 与同版本 `reviews/S064.review.md`，本地缓存提交 `ddddbec4292648eb90b1cd23d514e73290a29b05`（#4552），评审 Verdict: PASS。方法 A–D 与 F1–F8 恢复自该作者化正文；本次没有重新访问外部上游仓库，以下外部归因保留原作者化记录，不冒充本轮重新核验。

- anthropics/knowledge-work-plugins，product-management/skills/write-spec/SKILL.md，da38ec1ee89d41e5380e652a97382695003396e7，Apache-2.0：原记录为 adapt Problem Statement 要点，仅中文重述，不复制正文。
- RefoundAI/lenny-skills，skills/writing-prds/SKILL.md，13598cc54e09399bc1bc1398b0fca284110efb2f，MIT：reference-only，不复制播客引语。
- 解法剥离、候选选择重入、负空间、证伪条件和替代框定为 WorkspaceX 作者化设计，不归因于外部上游。

## 1.1.0 变更

把已作者化方法恢复为包内可装载引用，补充当前 D003 失败所需的真实性检查及 W029 现有简化输出投影。明确完整 ProblemFrame 检查、来源验证与存储尚未接线。保留已发布 1.0.0 JSON 不变；新版本不自动导入、发布、固定到角色或覆盖旧实例。
