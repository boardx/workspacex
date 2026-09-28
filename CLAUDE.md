# CLAUDE.md — Claude Code 适配入口

@AGENTS.md

<!-- Claude Code 专属补充（其余规则全部以 AGENTS.md 为准）
     - Skills 路径：.claude/skills/ 只放软链，真身在 .agents/skills/。**不是全量投影**——
       哪些链进来了以 `ls .claude/skills` 为准（2026-09-27 前此目录并不存在，本行却写着已软链）；
       形状由 .harness/scripts/claude-skills-link.test.ts 门控；全量投影见 docs/proposals/community-practice-review-2026-07.md P1
     - Subagents：.claude/agents/（独立上下文、工具权限、避免自我背书）
     - 本地覆盖：CLAUDE.local.md（gitignore，机器特定配置）
-->
