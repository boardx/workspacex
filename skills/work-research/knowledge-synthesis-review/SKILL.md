---
name: knowledge-synthesis-review
version: 1.0.0
capability_id: WX-WORK-S169
metadata:
  work:
    stableId: S169
    domain: "Research"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "enterprise-search/skills/knowledge-synthesis/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "github/awesome-copilot"
        path: "skills/build-evidence-map/SKILL.md"
        commit: "6c4d33b9cfca967a28bb2962ef4d55e4a384c88c"
        license: "MIT"
        strategy: "adapt"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S169
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S169-knowledge-synthesis.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S169-knowledge-synthesis.md#输出契约"
      summary: "见实体文档输出契约。"
---

# 知识综合（S169）

> Work Skill · v2 实体编号 S169 · 领域 Research
> 依据 `requirements/work-stack-v2/skills/S169-knowledge-synthesis.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

同一件事会以不同的样子出现在多处：会议纪要里一句、邮件里一次确认、文档 v3 里一节，而组织以前的研究也可能早就写过。S169 把这些材料归并成一张结构化知识图（`KnowledgeSynthesisMap`），图里有四样东西：

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S169-knowledge-synthesis.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S169-knowledge-synthesis.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：（见实体文档）
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`enterprise-search/skills/knowledge-synthesis/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `github/awesome-copilot`（`skills/build-evidence-map/SKILL.md`，commit `6c4d33b9cfca…`，MIT，策略 adapt）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S169 的行；本文件不复述矩阵。
