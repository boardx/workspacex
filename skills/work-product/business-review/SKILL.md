---
name: business-review
version: 1.0.0
capability_id: WX-WORK-S155
metadata:
  work:
    stableId: S155
    domain: "Operations & Project"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
      optional:
        - project.read
        - metric.read
        - finance.ledger.read
        - principal.visibility.check
        - org.config.read
        - citation.record
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "finance/skills/variance-analysis/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "github/awesome-copilot"
        path: "skills/gtm-board-and-investor-communication/SKILL.md"
        commit: "6c4d33b9cfca967a28bb2962ef4d55e4a384c88c"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S155
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S155-business-review.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S155-business-review.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 业务复盘（S155）

> Work Skill · v2 实体编号 S155 · 领域 Operations & Project
> 依据 `requirements/work-stack-v2/skills/S155-business-review.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

金额+百分比双阈值任一越过即触发显著性，坏消息前置，上期复盘行动是否闭环要有账本，解释必须引用上游分析产物。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S155-business-review.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S155-business-review.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read
- optional：project.read, metric.read, finance.ledger.read, principal.visibility.check, org.config.read, citation.record
- 完整依赖与授权边界见实体文档对应章节。
