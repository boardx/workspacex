---
name: pipeline-review
version: 1.0.0
capability_id: WX-WORK-S030
metadata:
  work:
    stableId: S030
    domain: "Sales"
    riskClass: low
    dependencies:
      required: []
      optional:
        - "crm.read"
        - "docs.read"
        - "email.read"
        - "sandbox.exec"
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/pipeline-review/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/deal-review/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S030
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S030-pipeline-review.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S030-pipeline-review.md#输出契约"
      summary: "见实体文档输出契约；本 SKILL.md 不复述其字段定义，避免同一事实两处声明。"
---

# 管道审阅（S030）

> Work Skill · v2 实体编号 S030 · 领域 Sales
> 依据 `requirements/work-stack-v2/skills/S030-pipeline-review.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

按组织自有阶段名汇总管道、用阶段进入历史算停留时长（无历史退回创建日期并说明）、用近两季已关闭商机做转化基线；资格框架逐要素标 confirmed/assumed/unknown 并各带引用。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S030-pipeline-review.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S030-pipeline-review.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：crm.read、docs.read、email.read、sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`sales/skills/pipeline-review/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `anthropics/knowledge-work-plugins`（`sales/skills/deal-review/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）

## 使用本 Skill 的 Workflow

W015 Weekly Pipeline Review（矩阵第 21 行）首位。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S030 的行；本文件不复述矩阵。
