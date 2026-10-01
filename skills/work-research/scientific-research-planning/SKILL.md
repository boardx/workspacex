---
name: scientific-research-planning
version: 1.0.0
capability_id: WX-WORK-S170
metadata:
  work:
    stableId: S170
    domain: "Research"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
      optional:
        - knowledge.search
    provenance:
      - repo: "K-Dense-AI/claude-scientific-skills（本地 clone：`scratchpad/upstream/claude-scientific-skills`）"
        path: "skills/hypothesis-generation/SKILL.md"
        commit: "49c6e97775eaa18ba791bebe23162a70ae601c18"
        license: "MIT"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins（本地 clone：`scratchpad/upstream/knowledge-work-plugins`）"
        path: "bio-research/skills/scientific-problem-selection/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S170
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S170-scientific-research-planning.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S170-scientific-research-planning.md#输出契约"
      summary: "见实体文档输出契约。"
---

# 科研规划（S170）

> Work Skill · v2 实体编号 S170 · 领域 Research
> 依据 `requirements/work-stack-v2/skills/S170-scientific-research-planning.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

回答：「在动手找证据之前，这个研究问题应当被拆成哪些可检验的子问题、每个子问题需要什么样的证据才算回答、什么结果会推翻我们的预期？」

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S170-scientific-research-planning.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S170-scientific-research-planning.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `K-Dense-AI/claude-scientific-skills（本地 clone：`scratchpad/upstream/claude-scientific-skills`）`（`skills/hypothesis-generation/SKILL.md`，commit `49c6e97775ea…`，MIT，策略 adapt）
- `anthropics/knowledge-work-plugins（本地 clone：`scratchpad/upstream/knowledge-work-plugins`）`（`bio-research/skills/scientific-problem-selection/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S170 的行；本文件不复述矩阵。
