---
name: competitive-analysis
version: 1.0.0
capability_id: WX-WORK-S008
metadata:
  work:
    stableId: S008
    domain: "Shared"
    riskClass: low
    dependencies:
      required: []
      optional:
        - knowledge.search
        - knowledge.read
        - web.fetch
        - sandbox.exec
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "product-management/skills/competitive-brief/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/competitive-intelligence/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
      - repo: "K-Dense-AI/claude-scientific-skills"
        path: "skills/market-research-reports/SKILL.md"
        commit: "49c6e97775eaa18ba791bebe23162a70ae601c18"
        license: "MIT"
        strategy: "adapt"
        copied: false
      - repo: "RefoundAI/lenny-skills"
        path: "skills/competitive-strategy/SKILL.md"
        commit: "13598cc54e09399bc1bc1398b0fca284110efb2f"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S008
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S008-competitive-analysis.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S008-competitive-analysis.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 竞品分析（S008）

> Work Skill · v2 实体编号 S008 · 领域 Shared
> 依据 `requirements/work-stack-v2/skills/S008-competitive-analysis.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

竞争集分层含 non-consumption，按真实体验而非营销话术评级，矩阵单元格状态闭集且非 unknown/NA 必须有证据；输出恒为 internal-only。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S008-competitive-analysis.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S008-competitive-analysis.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：knowledge.search, knowledge.read, web.fetch, sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。
