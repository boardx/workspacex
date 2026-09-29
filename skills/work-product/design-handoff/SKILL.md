---
name: design-handoff
version: 1.0.0
capability_id: WX-WORK-S076
metadata:
  work:
    stableId: S076
    domain: "Product / Design"
    riskClass: low
    dependencies:
      required:
        - design.read
        - knowledge.read
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "design/skills/design-handoff/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "openai/skills"
        path: "skills/.curated/figma-implement-design/SKILL.md"
        commit: "49f948faa9258a0c61caceaf225e179651397431"
        license: "Figma Developer Terms"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S076
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S076-design-handoff.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S076-design-handoff.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 设计交接（S076）

> Work Skill · v2 实体编号 S076 · 领域 Product / Design
> 依据 `requirements/work-stack-v2/skills/S076-design-handoff.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

视觉/交互/内容/边界/无障碍五类覆盖面的状态穷举，用 token 不用数值；只产出验收判据，不做像素比对。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S076-design-handoff.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S076-design-handoff.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：design.read, knowledge.read
- optional：无
- 完整依赖与授权边界见实体文档对应章节。
