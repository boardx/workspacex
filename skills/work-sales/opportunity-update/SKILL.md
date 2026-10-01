---
name: opportunity-update
version: 1.0.0
capability_id: WX-WORK-S029
metadata:
  work:
    stableId: S029
    domain: "Sales"
    riskClass: high
    dependencies:
      required:
        - "crm.read"
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/update-opportunity/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/log-activity/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S029
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S029-opportunity-update.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S029-opportunity-update.md#输出契约"
      summary: "见实体文档输出契约；本 SKILL.md 不复述其字段定义，避免同一事实两处声明。"
---

# 商机更新（S029）

> Work Skill · v2 实体编号 S029 · 领域 Sales
> 依据 `requirements/work-stack-v2/skills/S029-opportunity-update.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

写前必读当前值，产出 before/after 变更集（只列被请求或被接受的字段），条件写入防止批准等待期间被他人覆盖；写入本身是 Workflow 阶段的外部写效果，经 effect-gateway 执行，不是本 Skill 的依赖。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S029-opportunity-update.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S029-opportunity-update.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：crm.read
- optional：无
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`sales/skills/update-opportunity/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `anthropics/knowledge-work-plugins`（`sales/skills/log-activity/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 reference-only）

## 使用本 Skill 的 Workflow

W013 Meeting-to-Opportunity（矩阵第 19 行）产出变更集；W014（第 20 行）、W015 Weekly Pipeline Review（第 21 行）、W018 Account Expansion（第 24 行）均引用。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S029 的行；本文件不复述矩阵。
