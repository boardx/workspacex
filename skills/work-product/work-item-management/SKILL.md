---
name: work-item-management
version: 1.0.0
capability_id: WX-WORK-S142
metadata:
  work:
    stableId: S142
    domain: "Operations & Project"
    riskClass: low
    dependencies:
      required:
        - board.read
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "productivity/skills/task-management/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "product-management/skills/sprint-planning/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
      - repo: "github/awesome-copilot"
        path: "skills/github-issues/SKILL.md"
        commit: "6c4d33b9cfca967a28bb2962ef4d55e4a384c88c"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S142
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S142-work-item-management.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S142-work-item-management.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 工作项管理（S142）

> Work Skill · v2 实体编号 S142 · 领域 Operations & Project
> 依据 `requirements/work-stack-v2/skills/S142-work-item-management.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

只出建卡/流转/更新/依赖提议，不自行写入；建卡前必须重跑一次读取判重；changeSetId/proposalId 由输入哈希派生保证幂等重放。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S142-work-item-management.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S142-work-item-management.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：board.read
- optional：无
- 完整依赖与授权边界见实体文档对应章节。
