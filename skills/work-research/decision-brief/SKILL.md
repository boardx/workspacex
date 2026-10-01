---
name: decision-brief
version: 1.0.0
capability_id: WX-WORK-S012
metadata:
  work:
    stableId: S012
    domain: "Shared"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
        - sandbox.exec
      optional: []
    provenance:
      - repo: "adr/madr（`upstream/madr`）"
        path: "template/adr-template.md"
        commit: "ba75bb1b20d42af5746b246ad348c202419ae681"
        license: "MIT"
        strategy: "reference-only"
        copied: false
      - repo: "anthropics/knowledge-work-plugins（`upstream/kwp`）"
        path: "engineering/skills/architecture/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
      - repo: "refoundai/lenny-skills（`upstream/lenny-skills`）"
        path: "skills/high-stakes-decisions/SKILL.md"
        commit: "13598cc54e09399bc1bc1398b0fca284110efb2f"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S012
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S012-decision-brief.md#输入契约"
      summary: "输入不变量（在 zod `superRefine` 里实现，违反即返回对应 typed error）："
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S012-decision-brief.md#输出契约"
      summary: "「需要补框架」不是错误，而是 `status: needs-framing` 的正常产出（§5 欠定表）。"
---

# 决策简报（S012）

> Work Skill · v2 实体编号 S012 · 领域 Shared
> 依据 `requirements/work-stack-v2/skills/S012-decision-brief.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

S012 回答的问题是：「谁要在什么时候、在哪几个互斥方案之间做一个什么样的选择，每个方案凭什么证据好或不好，如果现在就要拍板我们建议哪个、有多大把握，什么信息会改变这个建议」。产出是一份 `DecisionBrief`，交给有权做决定的人。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S012-decision-brief.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S012-decision-brief.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read、sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `adr/madr（`upstream/madr`）`（`template/adr-template.md`，commit `ba75bb1b20d4…`，MIT，策略 reference-only）
- `anthropics/knowledge-work-plugins（`upstream/kwp`）`（`engineering/skills/architecture/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 reference-only）
- `refoundai/lenny-skills（`upstream/lenny-skills`）`（`skills/high-stakes-decisions/SKILL.md`，commit `13598cc54e09…`，MIT，策略 reference-only）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S012 的行；本文件不复述矩阵。
