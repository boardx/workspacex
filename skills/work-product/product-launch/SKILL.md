---
name: product-launch
version: 1.0.0
capability_id: WX-WORK-S073
metadata:
  work:
    stableId: S073
    domain: "Product"
    riskClass: low
    dependencies:
      required: []
      optional:
        - knowledge.read
    provenance:
      - repo: "RefoundAI/lenny-skills"
        path: "skills/launch-planning/SKILL.md"
        commit: "13598cc54e09399bc1bc1398b0fca284110efb2f"
        license: "MIT"
        strategy: "adapt"
        copied: false
      - repo: "github/awesome-copilot"
        path: "skills/gtm-0-to-1-launch/SKILL.md"
        commit: "6c4d33b9cfca967a28bb2962ef4d55e4a384c88c"
        license: "MIT"
        strategy: "adapt"
        copied: false
      - repo: "anthropics/knowledge-work-plugins"
        path: "marketing/skills/campaign-plan/SKILL.md"
        commit: "da38ec1ee89d41e5380e652a97382695003396e7"
        license: "Apache-2.0"
        strategy: "reference-only"
        copied: false
    locales: ["zh-CN", "en-US"]
    jurisdictions: ["CN", "US"]
    evalSuiteId: S073
    inputSchema:
      $ref: "requirements/work-stack-v2/skills/S073-product-launch.md#输入契约"
      summary: "完整输入契约见实体文档对应章节；本 frontmatter 不复述（同一事实不得声明在两处）。"
    outputSchema:
      $ref: "requirements/work-stack-v2/skills/S073-product-launch.md#输出契约"
      summary: "完整输出契约见实体文档对应章节。"
---

# 产品发布（S073）

> Work Skill · v2 实体编号 S073 · 领域 Product
> 依据 `requirements/work-stack-v2/skills/S073-product-launch.md`（单一事实源；本 SKILL.md 不复述其正文，仅摘要 + 指回原文）。

## 这个 Skill 解决什么问题

就绪门核对利益相关方签字、外部日期作为 forcing function；发布成功只认激活/留存读数，不认曝光；不含内容日历/渠道矩阵（归 S041）。

## 输入 / 输出契约

完整 `inputSchema` / `outputSchema` 定义见实体文档对应章节（本文件 frontmatter `metadata.work` 只放摘要 + 指回引用，避免同一事实两处声明）：
- 输入契约：`requirements/work-stack-v2/skills/S073-product-launch.md` 「输入契约」一节
- 输出契约：`requirements/work-stack-v2/skills/S073-product-launch.md` 「输出契约」一节

## 依赖（能力分类，ADR-120）

- required：无
- optional：knowledge.read
- 完整依赖与授权边界见实体文档对应章节。
