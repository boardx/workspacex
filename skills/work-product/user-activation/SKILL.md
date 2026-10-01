---
name: user-activation
version: 1.0.0
capability_id: WX-WORK-S074
metadata:
  work:
    stableId: S074
    domain: "Product"
    riskClass: low
    dependencies:
      required:
        - analytics.read
        - sandbox.exec
      optional: []
    provenance:
      - repo: "RefoundAI/lenny-skills"
        path: "skills/user-onboarding-activation/SKILL.md"
        commit: "13598cc54e09399bc1bc1398b0fca284110efb2f"
        license: "MIT"
        strategy: "reference-only"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "product-management/skills/metrics-review/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S074
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S074-user-activation.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S074-user-activation.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 用户激活分析（S074）

> Work Skill · v2 实体编号 S074 · 领域 Product
> 依据 `requirements/work-stack-v2/skills/S074-user-activation.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

激活里程碑必须与长期留存相关，门槛过低（大量到达但留存仍低）要能检出；对数据集访问做假名化核实，k 阈值不低于 20。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S074-user-activation.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S074-user-activation.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：analytics.read, sandbox.exec
- optional：无
- 完整依赖与授权边界见实体文档对应章节。
