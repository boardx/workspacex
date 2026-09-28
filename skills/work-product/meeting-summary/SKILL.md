---
name: meeting-summary
version: 1.0.0
capability_id: WX-WORK-S006
metadata:
  work:
    stableId: S006
    domain: "Shared"
    riskClass: low
    dependencies:
      required: []
      optional:
        - recording.read
        - knowledge.read
        - audio.transcribe
        - calendar.read
    provenance:
      - repo: "WorkspaceX"
        path: "skills/standard-audio/meeting-minutes/SKILL.md"
        commit: "30c1c4332025151610502988b0379b95ff7298c7"
        license: "MIT"
        strategy: "adapt"
        copied: false
      - repo: "github/awesome-copilot"
        path: "skills/meeting-minutes/SKILL.md"
        commit: "6c4d33b9cfca967a28bb2962ef4d55e4a384c88c"
        license: "MIT"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "sales/skills/call-summary/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S006
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S006-meeting-summary.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S006-meeting-summary.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 会议纪要（S006）

> Work Skill · v2 实体编号 S006 · 领域 Shared
> 依据 `requirements/work-stack-v2/skills/S006-meeting-summary.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

建议≠已批准决议、推迟≠否决、提到≠owner、摘要与明细分别对照原文、不编造词级时间戳，五条纪律升级为机检不变量。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S006-meeting-summary.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S006-meeting-summary.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：recording.read, knowledge.read, audio.transcribe, calendar.read
- 完整依赖与授权边界见实体文档对应章节。
