---
name: enterprise-search
version: 1.0.0
capability_id: WX-WORK-S003
metadata:
  work:
    stableId: S003
    domain: "Research"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
        - knowledge.search
        - mail.search
        - project.read
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "enterprise-search/skills/search-strategy/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "onyx-dot-app/onyx"
        path: "backend/onyx/context/search/enums.py"
        commit: "9ec4da4b0beb9946dd333d2b7390953d9aa89d6c"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S003
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S003-enterprise-search.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S003-enterprise-search.md#输出契约"
      summary: "没有 `summary` / `recommendation` 字段——刻意为之（决策 2）。"
---

# 企业内部检索（S003）

> Work Skill · v2 实体编号 S003 · 领域 Research
> 依据 `requirements/work-stack-v2/skills/S003-enterprise-search.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

「我们内部到底有没有、在哪、谁说的、现在还算不算数」——在调用方当前有权读取的组织资料里，把一个自然语言问题变成一组有范围声明的检索，返回可逐条核验的命中账本与覆盖声明（查了哪里、没查哪里、为什么没查）。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S003-enterprise-search.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S003-enterprise-search.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read、knowledge.search、mail.search、project.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`enterprise-search/skills/search-strategy/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `onyx-dot-app/onyx`（`backend/onyx/context/search/enums.py`，commit `9ec4da4b0beb…`，MIT，策略 reference-only）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S003 的行；本文件不复述矩阵。
