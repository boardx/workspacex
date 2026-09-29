---
name: sprint-planning
version: 1.0.0
capability_id: WX-WORK-S070
metadata:
  work:
    stableId: S070
    domain: "Product & Delivery"
    riskClass: low
    dependencies:
      required: []
      optional:
        - knowledge.read
        - team.roster.read
        - sprint.history.read
        - sandbox.exec
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "product-management/skills/sprint-planning/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "RefoundAI/lenny-skills"
        path: "skills/planning-cadence/SKILL.md"
        commit: "13598cc54e09399bc1bc1398b0fca284110efb2f"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S070
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S070-sprint-planning.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S070-sprint-planning.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 冲刺规划（S070）

> Work Skill · v2 实体编号 S070 · 领域 Product & Delivery
> 依据 `requirements/work-stack-v2/skills/S070-sprint-planning.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

按 70–80% 容量做承诺/stretch 分层，Sprint Backlog 是预测不是合同；优先级透传自 S068，负责人归属透传自 S142，不重算。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S070-sprint-planning.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S070-sprint-planning.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：knowledge.read, team.roster.read, sprint.history.read, sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。
