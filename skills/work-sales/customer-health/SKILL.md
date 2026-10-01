---
name: customer-health
version: 1.0.0
capability_id: WX-WORK-S035
metadata:
  work:
    stableId: S035
    domain: "Sales"
    riskClass: low
    dependencies:
      required:
        - "crm.read"
      optional:
        - "mail.search"
        - "calendar.read"
        - "tracker.read"
        - "product.usage.read"
        - "docs.read"
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/customer-health/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "github/awesome-copilot"
        path: "skills/gtm-enterprise-onboarding/SKILL.md"
        commit: "6c4d33b9cfca967a28bb2962ef4d55e4a384c88c"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S035
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S035-customer-health.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S035-customer-health.md#输出契约"
      summary: "见实体文档输出契约；本 SKILL.md 不复述其字段定义，避免同一事实两处声明。"
---

# 客户健康度（S035）

> Work Skill · v2 实体编号 S035 · 领域 Sales
> 依据 `requirements/work-stack-v2/skills/S035-customer-health.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

五维度（Relationship/Engagement trend/Commercial/Support/Value delivery）确定性合成健康分，只在可读来源里计入信号，否则标 not visible；总评指出驱动维度。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S035-customer-health.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S035-customer-health.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：crm.read
- optional：mail.search、calendar.read、tracker.read、product.usage.read、docs.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`sales/skills/customer-health/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `github/awesome-copilot`（`skills/gtm-enterprise-onboarding/SKILL.md`，commit `6c4d33b9cfca…`，MIT，策略 reference-only）

## 使用本 Skill 的 Workflow

W016 Forecast Review（矩阵第 22 行）、W017（不在第一阶段清单，不实现）、W018 Account Expansion（第 24 行）均引用。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S035 的行；本文件不复述矩阵。
