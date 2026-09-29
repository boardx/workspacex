---
name: customer-intelligence
version: 1.0.0
capability_id: WX-WORK-S021
metadata:
  work:
    stableId: S021
    domain: "Sales"
    riskClass: low
    dependencies:
      required:
        - "web.search"
        - "web.fetch"
        - "knowledge.search"
        - "knowledge.read"
      optional:
        - "crm.read"
        - "enrichment.company.read"
        - "registry.cn.read"
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/account-research/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/account-context/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S021
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S021-customer-intelligence.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S021-customer-intelligence.md#输出契约"
      summary: "见实体文档输出契约；本 SKILL.md 不复述其字段定义，避免同一事实两处声明。"
---

# 客户情报（S021）

> Work Skill · v2 实体编号 S021 · 领域 Sales
> 依据 `requirements/work-stack-v2/skills/S021-customer-intelligence.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

在调用方当前有权读取的组织与公开资料范围内，把一个客户/账户研究请求变成有来源标注的账户情报（关系、上下文、可核验维度），区分「blank（查了没有）」与「not queried（没查）」，不猜测不可核验的维度。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S021-customer-intelligence.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S021-customer-intelligence.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：web.search、web.fetch、knowledge.search、knowledge.read
- optional：crm.read、enrichment.company.read、registry.cn.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`sales/skills/account-research/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `anthropics/knowledge-work-plugins`（`sales/skills/account-context/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）

## 使用本 Skill 的 Workflow

W011 Lead-to-Qualified（矩阵第 17 行）、W012 Prospect-to-Meeting（第 18 行）位于 S024 之后：net-new 模式做单家公司深度情报；D005 Sales Representative 可在聊天中直接调用做即席账户研究。

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S021 的行；本文件不复述矩阵。
