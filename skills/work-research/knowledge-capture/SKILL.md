---
name: knowledge-capture
version: 1.0.0
capability_id: WX-WORK-S016
metadata:
  work:
    stableId: S016
    domain: "Shared"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
        - knowledge.search
        - project.read
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "customer-support/skills/kb-article/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "enterprise-search/skills/knowledge-synthesis/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "github/awesome-copilot"
        path: "skills/remember/SKILL.md"
        commit: "6c4d33b9cfca967a28bb2962ef4d55e4a384c88c"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S016
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S016-knowledge-capture.md#输入契约"
      summary: "输入不变量（违反即 typed error，§6.4）："
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S016-knowledge-capture.md#输出契约"
      summary: "`lesson` / `procedure` / `policy-rule` 在 `KgClaimKind` 里没有独立值：首版按 `fact` 入图并在 statement 前不加前缀、在 S016 记录里保留原值；是否扩 `KgClaimKind` 见 §14。"
---

# 知识捕获（S016）

> Work Skill · v2 实体编号 S016 · 领域 Shared
> 依据 `requirements/work-stack-v2/skills/S016-knowledge-capture.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

「这件事以后还会有人需要知道——把它变成一条能被查到、能被核验、能被推翻的组织知识提案」。输入是一段已经发生过的工作痕迹（会议记录、复盘、政策新旧版、入职问答、项目对话），输出是一组原子化的捕获记录（每条一句可独立成立的陈述 + 原话锚点 + 适用范围 + 建议写入层级 + 失效条件），以及一张交给人确认的写入提案。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S016-knowledge-capture.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S016-knowledge-capture.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read、knowledge.search、project.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`customer-support/skills/kb-article/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `anthropics/knowledge-work-plugins`（`enterprise-search/skills/knowledge-synthesis/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `github/awesome-copilot`（`skills/remember/SKILL.md`，commit `6c4d33b9cfca…`，MIT，策略 reference-only）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S016 的行；本文件不复述矩阵。
