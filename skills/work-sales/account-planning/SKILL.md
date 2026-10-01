---
name: account-planning
version: 1.0.0
capability_id: WX-WORK-S023
metadata:
  work:
    stableId: S023
    domain: "Sales"
    riskClass: low
    dependencies:
      required: []
      optional:
        - "crm.read"
        - "knowledge.read"
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/account-plan/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "github/awesome-copilot"
        path: "skills/gtm-enterprise-account-planning/SKILL.md"
        commit: "6c4d33b9cfca967a28bb2962ef4d55e4a384c88c"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S023
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S023-account-planning.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S023-account-planning.md#输出契约"
      summary: "见实体文档输出契约；本 SKILL.md 不复述其字段定义，避免同一事实两处声明。"
---

# 客户计划（S023）

> Work Skill · v2 实体编号 S023 · 领域 Sales
> 依据 `requirements/work-stack-v2/skills/S023-account-planning.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

按七段顺序（snapshot → goals → where we are → stakeholder coverage → opportunity map → risks → action plan）产出单账户计划；转写/邮件内容只作提议不直接写回；MAP 三周未更新标记为陈旧。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S023-account-planning.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S023-account-planning.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：crm.read、knowledge.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`sales/skills/account-plan/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `github/awesome-copilot`（`skills/gtm-enterprise-account-planning/SKILL.md`，commit `6c4d33b9cfca…`，MIT，策略 reference-only）

## 使用本 Skill 的 Workflow

W013 Meeting-to-Opportunity（矩阵第 19 行）G1 三选一之一；W014 Opportunity-to-Close（第 20 行）首位；D005 白名单内可即席调用。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S023 的行；本文件不复述矩阵。
