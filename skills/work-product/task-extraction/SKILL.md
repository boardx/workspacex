---
name: task-extraction
version: 1.0.0
capability_id: WX-WORK-S017
metadata:
  work:
    stableId: S017
    domain: "Shared"
    riskClass: low
    dependencies:
      required: []
      optional: []
    provenance:
      - repo: "anthropics/knowledge-work-plugins"
        path: "productivity/skills/task-management/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "productivity/skills/update/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
      - repo: "github/awesome-copilot"
        path: "skills/meeting-minutes/SKILL.md"
        commit: "6c4d33b9cfca967a28bb2962ef4d55e4a384c88c"
        license: "MIT"
        strategy: "adapt"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S017
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S017-task-extraction.md#输入契约"
      summary: "输入不变量（进门校验）："
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S017-task-extraction.md#输出契约"
      summary: "刻意不设 `ownerUserId`、`dueAt`、`priority`、`riskLevel`、`executor` 字段：前两者由 S142 解析（S142 M2、M4），风险等级在基线上只搬运不推导（`board.ts` 注释，VERIFIED@30c1…），S017 没有原话来源可以搬运。"
---

# 任务抽取（S017）

> Work Skill · v2 实体编号 S017 · 领域 Shared
> 依据 `requirements/work-stack-v2/skills/S017-task-extraction.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

上游已经把「谁说了要做什么」锚定到原话：W002 里是 S006 的 `commitmentCandidates[]`，W006 里是 S063 `capture-batch` 的 `knowledge-candidate`。S017 把这些承诺或待办的原始形态，规范成一份任务候选集 `TaskCandidateSet`。每条任务候选要说清五件事：

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S017-task-extraction.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S017-task-extraction.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：（见实体文档）
- 完整依赖与授权边界见实体文档对应章节。

## 溯源（G1）

- `anthropics/knowledge-work-plugins`（`productivity/skills/task-management/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 adapt）
- `anthropics/knowledge-work-plugins`（`productivity/skills/update/SKILL.md`，commit `da38ec1ee89d…`，Apache-2.0，策略 reference-only）
- `github/awesome-copilot`（`skills/meeting-minutes/SKILL.md`，commit `6c4d33b9cfca…`，MIT，策略 adapt）

## 使用本 Skill 的 Workflow

见 `requirements/work-stack-v2/WORKFLOW-SKILL-MATRIX.md` 与 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md` 中含 S017 的行；本文件不复述矩阵。
