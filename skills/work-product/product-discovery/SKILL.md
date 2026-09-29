---
name: product-discovery
version: 1.0.0
capability_id: WX-WORK-S061
metadata:
  work:
    stableId: S061
    domain: "Product & Design"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
        - skill-artifact.read
      optional:
        - sandbox.exec
    provenance:
      - repo: "RefoundAI/lenny-skills"
        path: "skills/continuous-discovery/SKILL.md"
        commit: "13598cc54e09399bc1bc1398b0fca284110efb2f"
        license: "MIT"
        strategy: "adapt"
        copied: false
      - repo: "RefoundAI/lenny-skills"
        path: "skills/idea-validation/SKILL.md"
        commit: "13598cc54e09399bc1bc1398b0fca284110efb2f"
        license: "MIT"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "product-management/skills/product-brainstorming/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "product-management/skills/write-spec/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S061
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S061-product-discovery.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S061-product-discovery.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 产品探索（S061）

> Work Skill · v2 实体编号 S061 · 领域 Product & Design
> 依据 `requirements/work-stack-v2/skills/S061-product-discovery.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

把一个模糊的产品意图变成假设账本 + 探索计划，事先登记检验判据，证据回来后机械改判 supported/refuted/inconclusive。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S061-product-discovery.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S061-product-discovery.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read, skill-artifact.read
- optional：sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。
