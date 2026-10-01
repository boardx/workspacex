---
name: user-interview-planning
version: 1.0.0
capability_id: WX-WORK-S062
metadata:
  work:
    stableId: S062
    domain: "Product"
    riskClass: low
    dependencies:
      required: []
      optional:
        - knowledge.read
        - interview.read
        - sandbox.exec
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "design/skills/user-research/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
      - repo: "RefoundAI/lenny-skills"
        path: "skills/customer-interviews/SKILL.md"
        commit: "13598cc54e09399bc1bc1398b0fca284110efb2f"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S062
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S062-user-interview-planning.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S062-user-interview-planning.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 用户访谈规划（S062）

> Work Skill · v2 实体编号 S062 · 领域 Product
> 依据 `requirements/work-stack-v2/skills/S062-user-interview-planning.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

从决策问题推出研究问题、证据缺口与方法映射，产出带分层下限与停止规则的招募计划与提纲。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S062-user-interview-planning.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S062-user-interview-planning.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：knowledge.read, interview.read, sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。
