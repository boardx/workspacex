---
name: sql-query
version: 1.0.0
capability_id: WX-WORK-S160
metadata:
  work:
    stableId: S160
    domain: "Data"
    riskClass: medium
    dependencies:
      required: []
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins（本地克隆 `scratchpad/upstream/kwp`）"
        path: "data/skills/write-query/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "github/awesome-copilot（`scratchpad/upstream/awesome-copilot`）"
        path: "skills/postgresql-optimization/SKILL.md"
        commit: "6c4d33b9cfca967a28bb2962ef4d55e4a384c88c"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S160
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S160-sql-query.md#输入契约"
      summary: "不变量："
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S160-sql-query.md#输出契约"
      summary: "不变量："
---

# SQL 查询（S160）

> Work Skill · v2 实体编号 S160 · 领域 Data
> 依据 `requirements/work-stack-v2/skills/S160-sql-query.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

回答一个具体问题：「把一个已界定好的数据问题，变成一条在已授权只读数据源上可执行、结果口径可解释、可复算的 SQL，并拿回有界的结果行。」

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S160-sql-query.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S160-sql-query.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：（见实体文档）
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins（本地克隆 `scratchpad/upstream/kwp`）`（`data/skills/write-query/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `github/awesome-copilot（`scratchpad/upstream/awesome-copilot`）`（`skills/postgresql-optimization/SKILL.md`，commit `6c4d33b9cfca…`，MIT，策略 reference-only）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S160 的行；本文件不复述矩阵。
