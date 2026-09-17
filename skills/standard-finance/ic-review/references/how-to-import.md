# 把这个 skill 装进别的系统

本目录是标准 Agent Skill 格式：一个 `SKILL.md`（YAML frontmatter + 正文）加可选
`references/`。凡是吃这套格式的运行时都能直接用，下面按系统列出放哪。

## Claude Code

复制整个 `ic-review/` 目录到任一处：

- 项目级：`<你的仓库>/.claude/skills/ic-review/`
- 用户级：`~/.claude/skills/ic-review/`

之后在会话里按名字触发（`ic-review-standard`）。不需要额外配置。

## claude.ai（网页端）

把 `ic-review/` 打成 zip 上传到 Settings → Capabilities → Skills：

```bash
cd skills/standard-finance && zip -r ic-review.zip ic-review
```

## Claude Agent SDK

把目录放进 SDK 的 skills 目录，或按 SDK 文档以 `--skills` 指向它。

## WorkspaceX 自己（本平台）

**平台侧不用装**：这个 skill 已由 `apps/api/src/infrastructure/skill/ensure-platform-skill-catalog.ts`
随 API 进程启动自愈落库（skillId `skill-team1-ic-review-standard`），`/agent/team1`
的入口会把它挂进线程。本目录是给**别的系统**用的导出物，以及将来真要走
starter-pack 治理时的现成物料。两条路径不要同时启用，否则目录里会出现两个同名
skill、两条版本线，用户不知道该挂哪个。

## 这份 skill 需要什么运行时能力

正文会用到、但不强制的能力（缺了就退化，不会报错）：

| 能力 | 用途 | 缺了会怎样 |
|---|---|---|
| 文档解析（如 `wx_document_parse`） | 读 PDF/DOCX/XLSX/PPTX 材料 | 只能读纯文本材料 |
| 联网检索（如 `web_search` / `fetch_url`） | 任务四/五的公开信息与竞对数据 | 相关表格全部写「未检索到」——形式上仍合规，但那部分没有价值 |
| Excel 生成（如 `xlsx-create`） | 任务八的结果文件 | 出不了 .xlsx，只能给对话里的表格 |

⚠ 缺能力时正文要求 Agent「如实写明检索失败/未检索到」，不要用常识填空——
这条是这份方法论最要紧的性质，换到别的系统上同样成立。

## 版本

正文与 WorkspaceX 线上运行的那一份**逐字节相同**（由
`skills/standard-finance/scripts/build.ts` 从单一事实源导出，CI 有测试盯住漂移）。
正文有实质变化时，WorkspaceX 侧会升 `IC_REVIEW_SKILL_VERSION_ID`；导入方自行决定
是否跟随。
