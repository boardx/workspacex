# 来源与适配

WX-S012 是 WorkspaceX 领域适配方法，复用仓库现有 getCanvasSource/renderCanvas/updateCanvasSource 与 packages/fabric-markdown，不移植第二个绘图引擎。

Mermaid 官方语法参考：https://mermaid.js.org/syntax/flowchart.html （2026-09-07读取）。本 Skill 的步骤与检查清单为 WorkspaceX 编写，没有复制该文档内容。

既有引擎来源见仓库 packages/fabric-markdown/VENDOR.md：v0.1.0 基线来自无 Git 历史的本地上游，不能捏造上游提交 SHA。当前适配使用本仓依赖，不改变引擎或其许可。

仓库领域规则：.agents/skills/mod-canvas-diagram/SKILL.md，身份/序列化参考；契约 apps/api 的现有 Canvas 领域。保留 ID、模板 key、版本冲突与坐标不回写约束。
