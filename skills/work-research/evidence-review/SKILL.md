---
name: evidence-review
version: 1.0.0
capability_id: WX-WORK-S171
metadata:
  work:
    stableId: S171
    domain: "Research"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
        - sandbox.exec
      optional:
        - knowledge.search
    provenance:
      - repo: "K-Dense-AI/claude-scientific-skills"
        path: "skills/scientific-critical-thinking/SKILL.md"
        commit: "49c6e97775eaa18ba791bebe23162a70ae601c18"
        license: "MIT"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "data/skills/validate-data/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S171
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S171-evidence-review.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S171-evidence-review.md#输出契约"
      summary: "故意不含：`summary`、`recommendation`、`nextActions`（执行类）。`verdict` 只描述证据状态，不描述要不要采取行动。"
---

# 证据评审（S171）

> Work Skill · v2 实体编号 S171 · 领域 Research
> 依据 `requirements/work-stack-v2/skills/S171-evidence-review.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

回答一个具体问题：「这组证据能把这条主张撑到什么程度？」——对每条主张（claim）逐一给出：哪些证据真的支持、哪些反驳、每条证据自身可信度如何、合在一起的证据确定性等级是多少、以及按这个等级最多允许用什么措辞写进下游报告/建议。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S171-evidence-review.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S171-evidence-review.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read、sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `K-Dense-AI/claude-scientific-skills`（`skills/scientific-critical-thinking/SKILL.md`，commit `49c6e97775ea…`，MIT，策略 adapt）
- `anthropics/knowledge-work-plugins`（`data/skills/validate-data/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S171 的行；本文件不复述矩阵。
