# agentic-harness-template

**EN** — A batteries-included engineering process template for building software with
AI agents (solo or multi-agent), extracted from [BoardX](https://github.com/boardx)'s
production practice. It packages: a file-based delivery pipeline
(phase → sprint → feature) with **evidence-gated completion** (a feature is only
"passing" when its verification commands exit 0 and evidence is on disk), an audit
chain (`doctor`) that detects fake progress, a multi-agent coordination protocol
(atomic leases + authoritative clock + task inbox — interface only, bring your own
implementation or run single-agent), role & module knowledge-base skills with
experience backflow rules, and CI/CD patterns with deploy-drift probes.
Docs are primarily in Chinese; the structure is language-neutral. Start below.

---

## 这是什么

把「用 agent 开发软件」的工程过程打包成可复用模板——不是脚手架代码，是**过程本身**：

- **交付流水线**：phase（阶段）→ sprint → feature，`feature_list.json` 是唯一权威；
  **完成 = 验证命令退出码 0 + 证据落盘**，"代码写完了"不算完成。
- **审计链**：`pnpm harness verify` 是唯一能把 feature 翻成 passing 的门；
  `pnpm harness doctor` 体检假 passing / 证据缺失 / 派生视图漂移。
- **多 agent 协调（可选）**：原子租约 + 权威时钟 + 任务收件箱的协议契约
  （`docs/coordination-protocol.md`）；未配置时单 agent 模式照常可用。
- **组织模型**：主协调者（唯一合并权）→ 模块协调者 → 开发 agent，分级 loop 纪律。
- **知识回流**：每模块一个活知识库 skill（踩坑 append-only），谁干活谁回流。
- **DevOps 模式**：有 CD 的目标不手动部署；冒烟带部署漂移探针；env 变更与部署原子。

每条规则背后都有上游真实事故或收益，ADR（`docs/adr/`）保留了完整出处。

**想先懂思想再上手**：[docs/CONCEPTS.md](docs/CONCEPTS.md)——四种失效模式、11 个基础概念、最佳实践与阅读路径。

## 十分钟接入

```bash
# 1. Use this template 建仓后
./init.sh                                # 安装依赖 + 基础验证
# 2. 填两份文件（模板接入的全部配置面）：
#    .harness/instructions/project/PROJECT.md   ← 项目事实单点（域名/repo/模块清单）
#    .harness/config/github-sync.yaml           ← repo 字段
# 3. 起第一个阶段
pnpm harness new-phase --id 01 --name <名字> --goal "<目标>"
#    把原始需求（大白话）写进 phases/phase-01-*/requirements/*.md
# 4. 让 agent 读 AGENTS.md 开工——它会顺着目录页找到所有规则
pnpm harness new-sprint --phase 01 --id 01 --goal "..." --features F01,F02
pnpm harness verify --sprint 01/01        # 唯一的完成之门
```

## 目录结构（三平面）

| 平面 | 位置 | 内容 |
|---|---|---|
| 代码 | `apps/` `packages/` | 你的业务（模板只带 `coord-protocol` 协议包） |
| 控制 | `.harness/` | 指令/模板/量规/脚本/状态——harness 大脑 |
| 交付 | `phases/` | 阶段 → sprint → feature 时间线 |

技术架构方案：参考栈（分层选型+可替换点+部署三形态）见
`.harness/instructions/architecture.md`；组织大脑/知识图谱（PG canonical +
pgvector + Apache AGE 图投影，hybrid 检索）见 `docs/proposals/PROP-ORG-BRAIN-KG-001.md` 与 ADR-114；
harness 元本体见 `docs/architecture/knowledge-ontology.md`。

入口永远是 `AGENTS.md`（≤100 行目录页，agent 每次开工第一个读的文件）。

## 双工具支持：Claude Code + Codex

模板同时支持 **Claude Code** 和 **OpenAI Codex** 作为执行 agent 的 CLI 工具，规格只写
一次：

- 角色/审查类 subagent（code-reviewer / e2e-verifier / feature-evaluator 等）的规格
  写在 `.harness/agents/*.yaml`（工具无关的中立描述：`role`/`tools`/`system_prompt`/
  `model: {claude, codex}` 每工具可各自指定模型）。
- `pnpm harness gen-subagents` 从同一份 yaml 生成两种格式：
  - `.claude/agents/<name>.md`（YAML frontmatter + system prompt，Claude Code 原生格式）
  - `.codex/agents/<name>.toml`（Codex 原生格式）
- **两份生成物都入库**，CI 有漂移检查（改了 yaml 忘记重新生成 = 直接红）：改 spec 后
  记得重跑 `pnpm harness gen-subagents` 再提交。
- 长驻角色（coordinator / module-coordinator / worker，见 `.harness/agents/registry.yaml`）
  同样工具无关：`agent-bootstrap.md`/`coordinator-sop.md` 等执行书不绑定任何一个
  CLI 工具的语法，`pnpm harness tick`/`claim`/`verify` 等命令两边通用（都是纯 shell +
  Node 脚本，不依赖某个工具的专有能力）。

## 许可证与商标

代码以 Apache-2.0 开源（[`LICENSE`](LICENSE)）；名称与 logo 的使用规则见
[`TRADEMARKS.md`](TRADEMARKS.md)——修改后再分发的 fork 须改名。

## 与上游的关系

方法论层持续从 BoardX 上游单向同步（ADR 编号 <100 为上游方法论，你的项目从
ADR-100 起自编）。发现模板本身的问题欢迎回流 PR——回流规则本身也是模板的一部分
（`.agents/skills/mod-_template/SKILL.md` 文末）。
