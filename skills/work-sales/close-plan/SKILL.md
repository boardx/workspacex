---
name: close-plan
version: 1.0.0
capability_id: WX-WORK-S032
metadata:
  work:
    stableId: S032
    domain: "Sales"
    riskClass: low
    dependencies:
      required: []
      optional:
        - "crm.read"
        - "transcript.read"
        - "mail.read"
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/close-plan/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/deal-advance-gap/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S032
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S032-close-plan.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S032-close-plan.md#输出契约"
      summary: "见实体文档输出契约；本 SKILL.md 不复述其字段定义，避免同一事实两处声明。"
---

# 成交计划（S032）

> Work Skill · v2 实体编号 S032 · 领域 Sales
> 依据 `requirements/work-stack-v2/skills/S032-close-plan.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

产出 business case + Mutual Action Plan 两件产物，从目标签约日倒排双方步骤，标出使关闭日期不可能的步骤；没有客户证据的论点是待验证点，不是断言。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S032-close-plan.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S032-close-plan.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：crm.read、transcript.read、mail.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`sales/skills/close-plan/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `anthropics/knowledge-work-plugins`（`sales/skills/deal-advance-gap/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 reference-only）

## 使用本 Skill 的 Workflow

W014 Opportunity-to-Close（矩阵第 20 行）。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S032 的行；本文件不复述矩阵。
