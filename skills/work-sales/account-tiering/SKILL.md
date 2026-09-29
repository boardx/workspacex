---
name: account-tiering
version: 1.0.0
capability_id: WX-WORK-S022
metadata:
  work:
    stableId: S022
    domain: "Sales"
    riskClass: low
    dependencies:
      required: []
      optional:
        - "crm.read"
        - "email.read"
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/account-tiering/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "refoundai/lenny-skills"
        path: "skills/defining-icp/SKILL.md"
        commit: "13598cc54e09399bc1bc1398b0fca284110efb2f"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S022
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S022-account-tiering.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S022-account-tiering.md#输出契约"
      summary: "见实体文档输出契约；本 SKILL.md 不复述其字段定义，避免同一事实两处声明。"
---

# 账户分层（S022）

> Work Skill · v2 实体编号 S022 · 领域 Sales
> 依据 `requirements/work-stack-v2/skills/S022-account-tiering.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

把候选/既有账户按 Fit（契合度）× Engagement（参与度）两轴打分归入四象限，缺信号的维度去掉并重新归一且注明，输出可解释到具体信号、可复现的分层结果与建议打法。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S022-account-tiering.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S022-account-tiering.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：crm.read、email.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`sales/skills/account-tiering/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `refoundai/lenny-skills`（`skills/defining-icp/SKILL.md`，commit `13598cc54e09…`，MIT，策略 reference-only）

## 使用本 Skill 的 Workflow

W011 Lead-to-Qualified（矩阵第 17 行）S024 之后做分层；D005 Sales Representative 白名单内 Skill，可即席对单账户重算层级（`account-check` 模式）。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S022 的行；本文件不复述矩阵。
