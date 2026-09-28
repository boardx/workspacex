---
name: statistical-analysis
version: 1.0.0
capability_id: WX-WORK-S161
metadata:
  work:
    stableId: S161
    domain: "Data"
    riskClass: low
    dependencies:
      required:
        - data.read
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "data/skills/statistical-analysis/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "K-Dense-AI/claude-scientific-skills"
        path: "skills/statistical-analysis/SKILL.md"
        commit: "49c6e97775eaa18ba791bebe23162a70ae601c18"
        license: "MIT"
        strategy: "adapt"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S161
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S161-statistical-analysis.md#输入契约"
      summary: "输入不变式（违反 → `InvalidInput`）："
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S161-statistical-analysis.md#输出契约"
      summary: "输出不变式（`superRefine`，违反 → `OutputInvariantViolation`，报告不交给下游）："
---

# 统计分析（S161）

> Work Skill · v2 实体编号 S161 · 领域 Data
> 依据 `requirements/work-stack-v2/skills/S161-statistical-analysis.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

回答一个具体问题：「这组已经过校验的数据，对一个事先写下的统计假设，能给出多大、多确定的定量结论？」

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S161-statistical-analysis.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S161-statistical-analysis.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：（见实体文档）
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`data/skills/statistical-analysis/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `K-Dense-AI/claude-scientific-skills`（`skills/statistical-analysis/SKILL.md`，commit `49c6e97775ea…`，MIT，策略 adapt）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S161 的行；本文件不复述矩阵。
