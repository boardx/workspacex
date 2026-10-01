---
name: problem-framing
version: 1.0.0
capability_id: WX-WORK-S064
metadata:
  work:
    stableId: S064
    domain: "Product & Design"
    riskClass: low
    dependencies:
      required: []
      optional:
        - knowledge.read
        - sandbox.exec
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "product-management/skills/write-spec/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "RefoundAI/lenny-skills"
        path: "skills/writing-prds/SKILL.md"
        commit: "13598cc54e09399bc1bc1398b0fca284110efb2f"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S064
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S064-problem-framing.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S064-problem-framing.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 问题框定（S064）

> Work Skill · v2 实体编号 S064 · 领域 Product & Design
> 依据 `requirements/work-stack-v2/skills/S064-problem-framing.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

把一个入口（功能名/问题陈述/用户请求/模糊想法）写成与解法无关的问题陈述，含受影响主体、频率、不解决的代价与证据引用。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S064-problem-framing.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S064-problem-framing.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：knowledge.read, sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。
