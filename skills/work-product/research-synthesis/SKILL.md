---
name: research-synthesis
version: 1.0.0
capability_id: WX-WORK-S063
metadata:
  work:
    stableId: S063
    domain: "Research"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
        - sandbox.exec
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "product-management/skills/synthesize-research/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "design/skills/research-synthesis/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "enterprise-search/skills/knowledge-synthesis/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S063
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S063-research-synthesis.md#输入契约"
      summary: "S063 不定义自己的证据类型，直接消费上游 Skill 的输出类型，不设适配层："
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S063-research-synthesis.md#输出契约"
      summary: "见实体文档输出契约。"
---

# 研究综合（S063）

> Work Skill · v2 实体编号 S063 · 领域 Research
> 依据 `requirements/work-stack-v2/skills/S063-research-synthesis.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

把已经收集好的一批材料变成少量可逐条追溯的 Finding。每个 Finding 是一句可证伪的陈述，挂着支持与反驳它的证据 id，带一个按确定性算法得出的置信度和措辞上限，并且把「观察」与「解释」分开写。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S063-research-synthesis.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S063-research-synthesis.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read、sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`product-management/skills/synthesize-research/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `anthropics/knowledge-work-plugins`（`design/skills/research-synthesis/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 reference-only）
- `anthropics/knowledge-work-plugins`（`enterprise-search/skills/knowledge-synthesis/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 reference-only）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S063 的行；本文件不复述矩阵。
