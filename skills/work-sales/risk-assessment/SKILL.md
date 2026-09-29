---
name: risk-assessment
version: 1.0.0
capability_id: WX-WORK-S010
metadata:
  work:
    stableId: S010
    domain: "Sales"
    riskClass: low
    dependencies:
      required: []
      optional:
        - "project.read"
        - "knowledge.read"
        - "org.policy.read"
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "operations/skills/risk-assessment/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "legal/skills/legal-risk-assessment/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S010
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S010-risk-assessment.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S010-risk-assessment.md#输出契约"
      summary: "见实体文档输出契约；本 SKILL.md 不复述其字段定义，避免同一事实两处声明。"
---

# 风险评估（S010）

> Work Skill · v2 实体编号 S010 · 领域 Sales
> 依据 `requirements/work-stack-v2/skills/S010-risk-assessment.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

风险类别清单 + 登记表字段（描述/似然/影响/缓解/负责人/状态）；似然必须挂靠 S171 的主张或明确标为判断，不做乘法打分。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S010-risk-assessment.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S010-risk-assessment.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：project.read、knowledge.read、org.policy.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`operations/skills/risk-assessment/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `anthropics/knowledge-work-plugins`（`legal/skills/legal-risk-assessment/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）

## 使用本 Skill 的 Workflow

W016 Forecast Review（矩阵第 22 行）额外依赖；此前已由 CT01 研究线 pack（`skills/work-research/risk-assessment/`）作者化——本文件是销售线 pack 的独立分发副本（starter-pack 打包边界所致：每条内容线是各自导入的独立 pack；同一 v2 实体 S010 的正文内容与上游许可单一事实源仍是 `requirements/work-stack-v2/skills/S010-risk-assessment.md`，两个 pack 副本均只摘要 + 指回，不分叉定义）。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S010 的行；本文件不复述矩阵。
