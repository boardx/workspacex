# phase-01 契约束 ↔ 需求目录 ↔ 截图目录 映射

> **为什么需要这张表**：三套目录名**互不相同**，人类已两次因此以为某个模块没有契约束
> （问「我没有看到 agents 的文件夹的 contracts」——`04-agent` 在 `agent-runtime/` 里）。
> 一个只存在于口头解释里的映射，等于不存在。

## 映射表

| 契约束（本目录） | 需求目录 `requirements/` | 截图目录 `ui-preview/` | feature | 点 |
|---|---|---|---:|---:|
| `project` | `00-project` | `project/` | 13 | 56 |
| `org-admin` | `01-auth` | `org-admin/` | 12 | 30 |
| `templates` | `02-tpl` | **`tpl-v2/`** | 14 | 50 |
| `skills` | `03-skill` | **`skill-v2/`** | 8 | 31 |
| **`agent-runtime`** | **`04-agent` + `20-model` + `21-mcp`** | **`agent-runtime-v2/`** | 13 | 53 |
| `recording` | `05-rec` | **`rec-v2/`** | 11 | 31 |
| `interview` | `06-itv` | **`itv-v2/`**（v1 `itv/` 已推翻） | 20 | 68 |
| `canvas` | `07-canvas` | **`canvas-v2/`** | 8 | 26 |
| `chat` | `08-chat` | **`chat-v2/`** | 8 | 24 |
| `files` | `22-files` | `files/` | 17 | 48 |

**只有 `project` / `canvas` / `chat` / `files` 三套名字一致**，其余七束至少有一处不同。

## 为什么 `agent-runtime` 合并了三个 area

`agent`(6) · `model`(4) · `mcp`(3) 各自成束的话，签核开销比内容还高，
而它们本来就是同一条能力链：**注册 agent → 选模型 → 挂 MCP 工具**。
三者的不变量互相引用（agent 的工具白名单是 MCP 服务器→工具两级；
机密路由同时约束模型选择与 agent 调用），拆开会让交叉约束无处安放。

## 为什么截图目录多数带 `-v2`

2026-07-30 的**保真度审计**发现八处「画的东西与原型对不上」，六个域的原型被重做。
推翻的版本**保留原目录留痕**（如 `itv/` 44 张），新版进 `-v2/`。
`contracts/<束>/ui.md` 指向的是**新版**；哪个目录算数由
`.harness/scripts/ui-material-map.json` 声明，`lint-ui-material` 机械核对**双向集合相等**。

⚠ 因此**不要**凭目录名猜——`ui-preview/itv/` 存在但**不是**签核材料。

## 单一事实源

- 束 ↔ feature：各束 `design-signoff.md` frontmatter 的 `covers:`（ADR-023 决策三）
- 束 ↔ 截图目录：`.harness/scripts/ui-material-map.json`
- **本表是派生视图，不是权威**。改归属请改上面两处，然后回来同步这张表。

## 还没有束的

| 需求目录 | 状态 |
|---|---|
| `23-asset`（外来资产导入与生命周期治理） | 2026-07-30 人类新提需求，第 11 束 `asset-governance` 在建 |
