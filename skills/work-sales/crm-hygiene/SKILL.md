---
name: crm-hygiene
version: 1.0.0
capability_id: WX-WORK-S034
metadata:
  work:
    stableId: S034
    domain: "Sales"
    riskClass: low
    dependencies:
      required: []
      optional:
        - "crm.read"
        - "docs.read"
        - "email.read"
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/crm-hygiene-check/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/update-opportunity/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S034
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S034-crm-hygiene.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S034-crm-hygiene.md#输出契约"
      summary: "见实体文档输出契约；本 SKILL.md 不复述其字段定义，避免同一事实两处声明。"
---

# CRM 卫生检查（S034）

> Work Skill · v2 实体编号 S034 · 领域 Sales
> 依据 `requirements/work-stack-v2/skills/S034-crm-hygiene.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

只读扫描 CRM 记录质量问题（完整性/时效性/一致性/唯一性/有效性 + 线索去重与同意记录），区分 blank 与 not queried；修复交给 S029，本身零写副作用。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S034-crm-hygiene.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S034-crm-hygiene.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：crm.read、docs.read、email.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`sales/skills/crm-hygiene-check/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `anthropics/knowledge-work-plugins`（`sales/skills/update-opportunity/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 reference-only）

## 使用本 Skill 的 Workflow

W011 Lead-to-Qualified（矩阵第 17 行）末位（`lead-gate` 模式）；W015 Weekly Pipeline Review（第 21 行）。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S034 的行；本文件不复述矩阵。
