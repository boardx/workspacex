---
name: proposal-builder
version: 1.0.0
capability_id: WX-WORK-S036
metadata:
  work:
    stableId: S036
    domain: "Sales"
    riskClass: low
    dependencies:
      required:
        - "pricebook.read"
      optional:
        - "crm.read"
        - "knowledge.read"
        - "file.read"
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/create-an-asset/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/handle-objection/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S036
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S036-proposal-builder.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S036-proposal-builder.md#输出契约"
      summary: "见实体文档输出契约；本 SKILL.md 不复述其字段定义，避免同一事实两处声明。"
---

# 方案/报价构建（S036）

> Work Skill · v2 实体编号 S036 · 领域 Sales
> 依据 `requirements/work-stack-v2/skills/S036-proposal-builder.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

产品/定价/合规主张只来自组织批准材料，否则标 UNVERIFIED；受众门阻止内部内容进入对外材料；客户侧数字必须挂来源；先出提纲后渲染。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S036-proposal-builder.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S036-proposal-builder.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：pricebook.read
- optional：crm.read、knowledge.read、file.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`sales/skills/create-an-asset/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `anthropics/knowledge-work-plugins`（`sales/skills/handle-objection/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 reference-only）

## 使用本 Skill 的 Workflow

W018 Account Expansion（矩阵第 24 行）。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S036 的行；本文件不复述矩阵。
