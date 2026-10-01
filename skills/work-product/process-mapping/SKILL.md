---
name: process-mapping
version: 1.0.0
capability_id: WX-WORK-S018
metadata:
  work:
    stableId: S018
    domain: "Operations"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
      optional:
        - project.read
        - sandbox.exec
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "operations/skills/process-doc/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "operations/skills/process-optimization/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "github/awesome-copilot"
        path: "skills/draw-io-diagram-generator/SKILL.md"
        commit: "6c4d33b9cfca967a28bb2962ef4d55e4a384c88c"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S018
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S018-process-mapping.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S018-process-mapping.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 流程建模（S018）

> Work Skill · v2 实体编号 S018 · 领域 Operations
> 依据 `requirements/work-stack-v2/skills/S018-process-mapping.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

BPMN 子集作为元素词表，异常路径、等待时间、审批、交接为必测字段，每个元素带证据与 basis；不产出优化建议（归 S156）。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S018-process-mapping.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S018-process-mapping.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read
- optional：project.read, sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。
