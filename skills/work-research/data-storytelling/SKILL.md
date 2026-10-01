---
name: data-storytelling
version: 1.0.0
capability_id: WX-WORK-S172
metadata:
  work:
    stableId: S172
    domain: "Research"
    riskClass: low
    dependencies:
      required:
        - artifact.read
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "data/skills/analyze/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "github/awesome-copilot"
        path: "instructions/power-bi-report-design-best-practices.instructions.md"
        commit: "6c4d33b9cfca967a28bb2962ef4d55e4a384c88c"
        license: "MIT"
        strategy: "adapt"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S172
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S172-data-storytelling.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S172-data-storytelling.md#输出契约"
      summary: "`UPSTREAM_BLOCKED` 时不产出故事（S161 `invalid-design` 的实验不应被\"讲成故事\"），只返回 error 和一段固定模板说明为何无叙事。"
---

# 数据叙事（S172）

> Work Skill · v2 实体编号 S172 · 领域 Research
> 依据 `requirements/work-stack-v2/skills/S172-data-storytelling.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

回答一个具体问题：「给定已经算好、已经评过级的结果，面对这位读者，应该按什么顺序讲哪几件事，每句话最多能说多重？」

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S172-data-storytelling.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S172-data-storytelling.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：artifact.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`data/skills/analyze/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `github/awesome-copilot`（`instructions/power-bi-report-design-best-practices.instructions.md`，commit `6c4d33b9cfca…`，MIT，策略 adapt）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S172 的行；本文件不复述矩阵。
