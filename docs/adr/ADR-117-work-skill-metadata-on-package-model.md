# ADR-117: Work Skill 元数据落在包模型上

- 状态: Proposed
- 适用层：项目实现（专属）
- 日期: 2026-09-28
- 关联：#4534 · `docs/proposals/PROP-WORK-STACK-001.md` · `requirements/work-stack-v2/`

## 背景
仓库有两套 Skill 模型：包模型（`skills` / `skill_versions`，SKILL.md + starter-pack，现有约 22 个平台 Skill）和声明式模型（`skill_contracts`，带审核/安全门）。两者都没有依赖（工具/能力）、结构化溯源、locale、评测、分类、废弃/后继字段。

## 决策
1. 200 个 Work Skill **全部用包模型承载**：`skills/<pack>/<skill>/SKILL.md` + `skills/starter-packs/<pack>/<ver>.json`，经现有启动导入发布到平台组织。
2. 新增 Zod 契约 `WorkSkillManifest`，写在 SKILL.md frontmatter 的 `metadata.work`，导入后进入不可变的 `skill_versions.manifest`：`stableId`、`domain`、`riskClass`、`dependencies{required[],optional[]}`（写能力分类，不写供应商）、`provenance[]`（repo/path/commit/license/strategy/copied/notice）、`locales[]`/`jurisdictions[]`、`evalSuiteId`、`inputSchema`/`outputSchema`。
3. 新增可变表 `skill_catalog_entries`：发布渠道（candidate / verified / deprecated）、后继 Skill、分类、搜索字段。`skills` 行的 enabled/disabled 语义不变。
4. 声明式模型不加 Work 字段；两套模型的收敛另立 issue，不在本项目内。

## 后果
- 不可变版本数据无需改表结构；可变的目录状态有独立归属。
- 运行时就绪性 = Skill 必需能力 × 组织已授权工具，由 `resolve-runtime-context` 计算。
