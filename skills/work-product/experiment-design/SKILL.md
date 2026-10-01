---
name: experiment-design
version: 1.0.0
capability_id: WX-WORK-S071
metadata:
  work:
    stableId: S071
    domain: "Product"
    riskClass: low
    dependencies:
      required: []
      optional:
        - sandbox.exec
    provenance:
      - repo: "K-Dense-AI/claude-scientific-skills"
        path: "skills/experimental-design/SKILL.md"
        commit: "49c6e97775eaa18ba791bebe23162a70ae601c18"
        license: "MIT"
        strategy: "adapt"
        copied: false
      - repo: "K-Dense-AI/claude-scientific-skills"
        path: "skills/statistical-power/SKILL.md"
        commit: "49c6e97775eaa18ba791bebe23162a70ae601c18"
        license: "MIT"
        strategy: "adapt"
        copied: false
      - repo: "RefoundAI/lenny-skills"
        path: "skills/product-experiments/SKILL.md"
        commit: "13598cc54e09399bc1bc1398b0fca284110efb2f"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S071
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S071-experiment-design.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S071-experiment-design.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 实验设计（S071）

> Work Skill · v2 实体编号 S071 · 领域 Product
> 依据 `requirements/work-stack-v2/skills/S071-experiment-design.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

单元与真重复层级、干扰因素、设计选择、闭式样本量，叠加业务闸门（值不值得做实验、稀释、护栏、holdout）。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S071-experiment-design.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S071-experiment-design.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。
