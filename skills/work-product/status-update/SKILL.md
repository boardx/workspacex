---
name: status-update
version: 1.0.0
capability_id: WX-WORK-S007
metadata:
  work:
    stableId: S007
    domain: "Shared"
    riskClass: low
    dependencies:
      required:
        - project.read
        - knowledge.read
      optional:
        - knowledge.search
        - citation.record
        - board.read
        - approval.read
        - workflow.receipt.read
        - principal.visibility.check
    provenance:
      - repo: "WorkspaceX"
        path: "skills/standard-context/project-status-report/SKILL.md"
        commit: "30c1c4332025151610502988b0379b95ff7298c7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/skills"
        path: "skills/internal-comms/SKILL.md"
        commit: "33375500bcea98d610eb30ce10ac4e59b89c390d"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "product-management/skills/stakeholder-update/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S007
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S007-status-update.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S007-status-update.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 状态更新（S007）

> Work Skill · v2 实体编号 S007 · 领域 Shared
> 依据 `requirements/work-stack-v2/skills/S007-status-update.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

Progress/Plans/Problems 三段时间窗，G/Y/R 由规则定色而非主观判断，每条断言挂证据，受众清算由服务端核实而非调用方声明。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S007-status-update.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S007-status-update.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：project.read, knowledge.read
- optional：knowledge.search, citation.record, board.read, approval.read, workflow.receipt.read, principal.visibility.check
- 完整依赖与授权边界见实体文档对应章节。
