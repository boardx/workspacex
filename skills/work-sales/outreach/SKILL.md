---
name: outreach
version: 1.0.0
capability_id: WX-WORK-S026
metadata:
  work:
    stableId: S026
    domain: "Sales"
    riskClass: medium
    dependencies:
      required: []
      optional:
        - "email.read"
        - "crm.read"
        - "org.suppression.read"
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/draft-outreach/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/schedule-meeting/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S026
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S026-outreach.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S026-outreach.md#输出契约"
      summary: "见实体文档输出契约；本 SKILL.md 不复述其字段定义，避免同一事实两处声明。"
---

# 外联文案起草（S026）

> Work Skill · v2 实体编号 S026 · 领域 Sales
> 依据 `requirements/work-stack-v2/skills/S026-outreach.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

起草外联文案草稿（三段式结构），收件人只能来自用户指定或 CRM；美国 CAN-SPAM/TCPA 与中国个保法/短信规定的机械合规检查；不自动发送。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S026-outreach.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S026-outreach.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：email.read、crm.read、org.suppression.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`sales/skills/draft-outreach/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `anthropics/knowledge-work-plugins`（`sales/skills/schedule-meeting/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 reference-only）

## 使用本 Skill 的 Workflow

W012 Prospect-to-Meeting（矩阵第 18 行）S021 之后；D005 白名单内可即席起草。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S026 的行；本文件不复述矩阵。
