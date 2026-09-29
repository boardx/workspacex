---
name: prospecting
version: 1.0.0
capability_id: WX-WORK-S024
metadata:
  work:
    stableId: S024
    domain: "Sales"
    riskClass: low
    dependencies:
      required:
        - "knowledge.search"
        - "knowledge.read"
        - "project.read"
        - "web.search"
        - "web.fetch"
      optional:
        - "crm.read"
        - "org.suppression.read"
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "partner-built/common-room/skills/prospect/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "partner-built/apollo/skills/prospect/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S024
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S024-prospecting.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S024-prospecting.md#输出契约"
      summary: "见实体文档输出契约；本 SKILL.md 不复述其字段定义，避免同一事实两处声明。"
---

# 拓客名单构建（S024）

> Work Skill · v2 实体编号 S024 · 领域 Sales
> 依据 `requirements/work-stack-v2/skills/S024-prospecting.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

产出可解释、可去重、可合规交接的候选目标公司名单（intake/net-new 两模式），只交付公司 + 目标角色槽位，不产出个人联系方式，不判定线索资格，不做深度情报。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S024-prospecting.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S024-prospecting.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.search、knowledge.read、project.read、web.search、web.fetch
- optional：crm.read、org.suppression.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`partner-built/common-room/skills/prospect/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `anthropics/knowledge-work-plugins`（`partner-built/apollo/skills/prospect/SKILL.md`，commit `da38ec1ee89d…`，MIT，策略 reference-only）

## 使用本 Skill 的 Workflow

W011 Lead-to-Qualified（矩阵第 17 行）首位，`mode=intake`；W012 Prospect-to-Meeting（第 18 行）首位，`mode=net-new`；D005 可即席调用做候选名单。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S024 的行；本文件不复述矩阵。
