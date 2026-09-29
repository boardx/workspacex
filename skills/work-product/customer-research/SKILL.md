---
name: customer-research
version: 1.0.0
capability_id: WX-WORK-S009
metadata:
  work:
    stableId: S009
    domain: "Shared"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
      optional:
        - transcript.read
        - ticket.read
        - survey.read
        - mail.search
        - crm.read
        - analytics.read
        - web.read
        - sandbox.exec
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "customer-support/skills/customer-research/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/customer-voice/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "RefoundAI/lenny-skills"
        path: "skills/analyzing-user-feedback/SKILL.md"
        commit: "13598cc54e09399bc1bc1398b0fca284110efb2f"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S009
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S009-customer-research.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S009-customer-research.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 客户研究（S009）

> Work Skill · v2 实体编号 S009 · 领域 Shared
> 依据 `requirements/work-stack-v2/skills/S009-customer-research.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

先判定请求类型与来源分层，只收客户本人说的逐字话，查不到的账户报为缺口而不是「没提到」；不产出结论。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S009-customer-research.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S009-customer-research.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read
- optional：transcript.read, ticket.read, survey.read, mail.search, crm.read, analytics.read, web.read, sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。
