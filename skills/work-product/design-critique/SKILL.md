---
name: design-critique
version: 1.0.0
capability_id: WX-WORK-S075
metadata:
  work:
    stableId: S075
    domain: "Product & Design"
    riskClass: low
    dependencies:
      required: []
      optional:
        - design.read
        - knowledge.read
        - sandbox.exec
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "design/skills/design-critique/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "github/awesome-copilot"
        path: "skills/web-design-reviewer/SKILL.md"
        commit: "6c4d33b9cfca967a28bb2962ef4d55e4a384c88c"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S075
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S075-design-critique.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S075-design-critique.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 设计评审（S075）

> Work Skill · v2 实体编号 S075 · 领域 Product & Design
> 依据 `requirements/work-stack-v2/skills/S075-design-critique.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

第一印象/可用性/视觉层级/一致性/无障碍五维度，0–4 档严重度，问题需定位到具体位置；不做浏览器截图（服务端没有浏览器）。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S075-design-critique.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S075-design-critique.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：design.read, knowledge.read, sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。
