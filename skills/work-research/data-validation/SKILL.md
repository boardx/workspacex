---
name: data-validation
version: 1.0.0
capability_id: WX-WORK-S158
metadata:
  work:
    stableId: S158
    domain: "Data"
    riskClass: low
    dependencies:
      required:
        - sandbox.exec
      optional:
        - data.read
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "data/skills/validate-data/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "unionai-oss/pandera"
        path: "pandera/errors.py"
        commit: "6e23433b4f010fdadc2e11b6229a43afd792abed"
        license: "MIT"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S158
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S158-data-validation.md#输入契约"
      summary: "不变式（入参校验，zod 层，违反即 `InvalidInput`，不进入方法）：`datasetId` 唯一；`fileRef` 与 `inlineRows` 恰有其一；`foreignKeys`/`joins`/`reconciliationPairs` 引用的 datasetId 必须存在；`window.from < window.to`；`severityOverrides` 不得把 `phi-leak` 降级（服务端强制，见 §7）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S158-data-validation.md#输出契约"
      summary: "不变式（输出 zod `superRefine` 检查，违反即 `OutputInvariantViolation`，报告不交给下游）："
---

# 数据校验（S158）

> Work Skill · v2 实体编号 S158 · 领域 Data
> 依据 `requirements/work-stack-v2/skills/S158-data-validation.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

回答一个具体问题：「这份数据集（及基于它算出的数）能不能被下一阶段当作事实使用？不能的话，具体坏在哪几行、哪条规则、影响哪个数？」

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S158-data-validation.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S158-data-validation.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：sandbox.exec
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`data/skills/validate-data/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `unionai-oss/pandera`（`pandera/errors.py`，commit `6e23433b4f01…`，MIT，策略 reference-only）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S158 的行；本文件不复述矩阵。
