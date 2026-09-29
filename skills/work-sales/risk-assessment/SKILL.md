---
name: risk-assessment
version: 1.0.0
capability_id: WX-WORK-S010
metadata:
  work:
    stableId: S010
    domain: "Shared"
    riskClass: low
    dependencies:
      required:
        - knowledge.read
        - project.read
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins（本地克隆 `scratchpad/upstream/kwp`）"
        path: "operations/skills/risk-assessment/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S010
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S010-risk-assessment.md#输入契约"
      summary: "不变量（输入）："
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S010-risk-assessment.md#输出契约"
      summary: "`RiskNote = { claimId: likelihoodBasis.claimIds[0] ?? null, description: event + \"→\" + consequence（≤240 字）, likelihood, severity, whatWouldChangeIt }`。排序规则是：先放 `severity=high ∧ likelihood≥medium` 的，再按 `level` 降序；取前 5 条。这样 W001 §5 阶段 5「必须在 `risks[0]`」的要求可以直接满足。`critical` 在 `RiskNote` 里没有对应档位，投影时 leve"
---

# 风险评估（S010）

> Work Skill · v2 实体编号 S010 · 领域 Shared
> 依据 `requirements/work-stack-v2/skills/S010-risk-assessment.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

回答的问题是：「这件事（结论、计划、合同、交易、供应商、预测）可能在哪里出错、出错了多痛、我们凭什么这么判断、谁该在什么信号出现时动手」。产出是一份风险登记表（`RiskAssessment`）。每条风险都写明：可观察的触发信号、似然与后果的依据、处置提案，以及谁有权接受这条风险。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S010-risk-assessment.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S010-risk-assessment.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：knowledge.read、project.read
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins（本地克隆 `scratchpad/upstream/kwp`）`（`operations/skills/risk-assessment/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 reference-only）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S010 的行；本文件不复述矩阵。
