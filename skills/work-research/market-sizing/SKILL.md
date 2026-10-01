---
name: market-sizing
version: 1.0.0
capability_id: WX-WORK-S167
metadata:
  work:
    stableId: S167
    domain: "Research"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
        - sandbox.exec
      optional: []
    provenance:
      - repo: "K-Dense-AI/claude-scientific-skills"
        path: "skills/market-research-reports/SKILL.md"
        commit: "49c6e97775eaa18ba791bebe23162a70ae601c18"
        license: "MIT"
        strategy: "reference-only"
        copied: false
      - repo: "Refound AI / lenny-skills"
        path: "skills/evaluating-startup-ideas/references/artifacts.md"
        commit: "13598cc54e09399bc1bc1398b0fca284110efb2f"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S167
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S167-market-sizing.md#输入契约"
      summary: "不变量：`topDown` 与 `bottomUp` 至少一个存在；只有一个时 `verdict` 上限 `directional`（决策 1）。所有比例 ∈ [0,1]；`scenarios.length ∈ [2,5]`；`dataPointId`/`componentId`/`segmentId` 唯一；同一路径内 `coverageKey` 唯一。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S167-market-sizing.md#输出契约"
      summary: "不变量：`som ≤ sam ≤ 所选 TAM`；`reconciliation.status=\"unreconciled\"` ⇒ `scopeDifferences.length ≥ 1` 且 `verdict ≠ decision-grade`；输出中每个数值都能由 `calculatorRun.inputHash` 对应的输入复算得出。故意不含 `recommendation`、`investmentView`。"
---

# 市场规模测算（S167）

> Work Skill · v2 实体编号 S167 · 领域 Research
> 依据 `requirements/work-stack-v2/skills/S167-market-sizing.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

回答一个问题：「在明确的市场定义、口径与时点下，这个市场有多大、我们能拿到多少，以及这个数字对哪几个假设最敏感？」

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S167-market-sizing.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S167-market-sizing.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read、sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `K-Dense-AI/claude-scientific-skills`（`skills/market-research-reports/SKILL.md`，commit `49c6e97775ea…`，MIT，策略 reference-only）
- `Refound AI / lenny-skills`（`skills/evaluating-startup-ideas/references/artifacts.md`，commit `13598cc54e09…`，MIT，策略 reference-only）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S167 的行；本文件不复述矩阵。
