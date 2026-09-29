---
name: data-exploration
version: 1.0.0
capability_id: WX-WORK-S157
metadata:
  work:
    stableId: S157
    domain: "Data"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
        - sandbox.exec
        - warehouse.read
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "data/skills/explore-data/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "K-Dense-AI/claude-scientific-skills（本地 clone 目录 `upstream/kdense`）"
        path: "skills/exploratory-data-analysis/SKILL.md"
        commit: "49c6e97775eaa18ba791bebe23162a70ae601c18"
        license: "MIT"
        strategy: "adapt"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S157
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S157-data-exploration.md#输入契约"
      summary: "输入不变式：`mode=\"question-scan\"` ⇒ `question` 非空；`mode=\"experiment-precheck\"` ⇒ `experiment` 存在且 `armColumn` 不在 `blindedMetrics` 中；`datasets` 中 `datasetRef` 不重复。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S157-data-exploration.md#输出契约"
      summary: "输出不变式："
---

# 数据探索（S157）

> Work Skill · v2 实体编号 S157 · 领域 Data
> 依据 `requirements/work-stack-v2/skills/S157-data-exploration.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

回答一个具体问题：「在正式查询和检验之前，这份数据到底长什么样、能不能回答这个问题、值得往哪几个方向查？」

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S157-data-exploration.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S157-data-exploration.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read、sandbox.exec、warehouse.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`data/skills/explore-data/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `K-Dense-AI/claude-scientific-skills（本地 clone 目录 `upstream/kdense`）`（`skills/exploratory-data-analysis/SKILL.md`，commit `49c6e97775ea…`，MIT，策略 adapt）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S157 的行；本文件不复述矩阵。
