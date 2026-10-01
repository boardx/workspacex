---
name: lead-triage
version: 1.0.0
capability_id: WX-WORK-S025
metadata:
  work:
    stableId: S025
    domain: "Sales"
    riskClass: low
    dependencies:
      required: []
      optional:
        - "crm.read"
        - "email.read"
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/lead-triage/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/route-lead/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S025
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S025-lead-triage.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S025-lead-triage.md#输出契约"
      summary: "见实体文档输出契约；本 SKILL.md 不复述其字段定义，避免同一事实两处声明。"
---

# 线索分诊（S025）

> Work Skill · v2 实体编号 S025 · 领域 Sales
> 依据 `requirements/work-stack-v2/skills/S025-lead-triage.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

按 fit/intent 两张表与 BANT / MEDDICC-lite 资格框架子集对线索分级（P0/P1/P2/DQ），只建议到 sales-accepted，SQL 由人确认；已有负责人的客户即路由答案。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S025-lead-triage.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S025-lead-triage.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：crm.read、email.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`sales/skills/lead-triage/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `anthropics/knowledge-work-plugins`（`sales/skills/route-lead/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 reference-only）

## 使用本 Skill 的 Workflow

W011 Lead-to-Qualified（矩阵第 17 行）S024 之后；D005 白名单内 Skill。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S025 的行；本文件不复述矩阵。
