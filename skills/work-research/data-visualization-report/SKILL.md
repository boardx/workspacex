---
name: data-visualization-report
version: 1.0.0
capability_id: WX-WORK-S164
metadata:
  work:
    stableId: S164
    domain: "Data"
    riskClass: low
    dependencies:
      required: []
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "data/skills/data-visualization/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "K-Dense-AI/claude-scientific-skills"
        path: "skills/scientific-visualization/SKILL.md"
        commit: "49c6e97775eaa18ba791bebe23162a70ae601c18"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S164
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S164-data-visualization.md#输入契约"
      summary: "入参约束：`audience=\"board\"` 时 `validationGate` 必填（W039）；`mode=\"spec\"` 只允许 `audience=\"dashboard\"`（W058）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S164-data-visualization.md#输出契约"
      summary: "见实体文档输出契约。"
---

# 数据可视化（S164）

> Work Skill · v2 实体编号 S164 · 领域 Data
> 依据 `requirements/work-stack-v2/skills/S164-data-visualization.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

把上游已经算好、已经校验过的结果表变成「读者一眼能读对」的图：选对图型、编码不失真、中文标签不缺字、单位/分母/时间窗写在图上，并交付图值 ↔ 结果表逐点对账与可复现渲染脚本。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S164-data-visualization.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S164-data-visualization.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：（见实体文档）
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`data/skills/data-visualization/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `K-Dense-AI/claude-scientific-skills`（`skills/scientific-visualization/SKILL.md`，commit `49c6e97775ea…`，MIT，策略 reference-only）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S164 的行；本文件不复述矩阵。
