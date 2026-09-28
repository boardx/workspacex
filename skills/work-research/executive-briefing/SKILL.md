---
name: executive-briefing
version: 1.0.0
capability_id: WX-WORK-S020
metadata:
  work:
    stableId: S020
    domain: "Research"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "product-management/skills/stakeholder-update/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
      - repo: "Refound AI / lenny-skills"
        path: "skills/executive-communication/SKILL.md"
        commit: "13598cc54e09399bc1bc1398b0fca284110efb2f"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S020
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S020-executive-briefing.md#输入契约"
      summary: "见实体文档输入契约。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S020-executive-briefing.md#输出契约"
      summary: "W001 只接收 `draftKind=\"brief\"`（W001 以 workflow-stage 调用，`preliminary-draft` 对 W001 不可达），映射为自己的 `Brief`（§6，已 PASS）：`bluf.refIds→claimIds`、`keyPoints(refId→claimId)`、`conflicts[].conflict`、`caveats`、`unknowns`、`notDecided` 直接对应；`risks` 不是一一对应——S020 只给 `{riskId, text}`；`riskId` 只存在于 S010 登记表，W001 §6 `Ris"
---

# 高管简报（S020）

> Work Skill · v2 实体编号 S020 · 领域 Research
> 依据 `requirements/work-stack-v2/skills/S020-executive-briefing.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

S020 只做一件事：把已经判定过可说到什么程度的材料（S171 审过的主张、S010 的风险注、S007 的状态项、S085 等给出的指标值及 S162 的指标判定）压成一份面向具体读者的简报正文——结论先行（BLUF）、3–5 个要点、冲突、限定语、未知项、风险、以及「本简报不替你做的决定」。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S020-executive-briefing.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S020-executive-briefing.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`product-management/skills/stakeholder-update/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 reference-only）
- `Refound AI / lenny-skills`（`skills/executive-communication/SKILL.md`，commit `13598cc54e09…`，MIT，策略 reference-only）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S020 的行；本文件不复述矩阵。
