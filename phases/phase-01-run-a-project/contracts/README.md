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
| `asset-governance` | `23-asset` | `asset-governance/` | **0**（未生成） | — |
| **`research`** | **`24-research`** | `research/`（**尚未产出**） | **0**（未生成） | **21**（估，D-20） |

**只有 `project` / `canvas` / `chat` / `files` / `asset-governance` / `research` 名字一致**，
其余六束至少有一处不同。
⚠ 表中「feature / 点」两列对**未生成 feature 的束**填 `0` 与估点，
**不要把估点读成已生成**——权威是各束 `design-signoff.md` 的 `covers:`（现在都是 `[]`）。

## `research` 这一行为什么现在就该在表里

D-20（2026-07-27）已裁「研究 Studio 立项（新模块，约 21 点）」，三份档案一致，
而**三个 phase 都没有该模块**——2026-07-30 补建。逐条证据见
[`../requirements/SCOPE-DELTA-2026-07-30.md`](../requirements/SCOPE-DELTA-2026-07-30.md)。

⚠ **它的截图目录 `ui-preview/research/` 尚未产出**，因此 `lint-ui-material` 会对它报红
（判定④「目录不存在 / 0 张 png」）。**那是正确的红**，理由见 `research/ui.md` 顶部。

⚠ **它的路由登记有一处「绿得不诚实」**：`nav-reachability.config.json` 里
`research → /studio/research` 使门控判定②通过，**但那条路由现在渲染的是
UC-0.2 Context Pack 的屏，不是本束的屏**（`navigation.ts:75` 的 `ucRefs` 逐字
`["00-core/uc-0-2"]`）。这是 `research/OPEN-QUESTIONS.md` **Q-2（阻塞级）**，
**裁定后必须回来复核这一行**。

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
| —（无） | 2026-07-30 起 phase-01 的每个需求目录都有对应束：`23-asset` → `asset-governance`（第 11 束）、`24-research` → `research`（第 12 束）|

## 明确**不属于** phase-01 的四个域（别再把它们当缺失）

`apps/web` 里已建成 `components/survey/` · `components/tasks/` · `components/brain/` ·
`components/studio/prototype-screen.tsx`，但它们**不属于 phase-01 的任何束，也不该属于**：

| 界面 | 它的需求在哪 | feature 在哪 |
|---|---|---|
| `components/survey/` · `/studio/survey` | `phase-02/requirements/12-survey/`（4 份 UC） | phase-02，**7 个** |
| `components/tasks/` · `/tasks` | `phase-02/requirements/11-board/`（7 份 UC） | phase-02，**10 个** |
| `components/brain/` · `/brain` | `phase-03/requirements/14-brain/`（6 份 UC） | phase-03，**21 个** |
| `components/studio/prototype-screen.tsx` | **尚无 UC** —— D-21 已裁 phase-2，2026-07-30 补登记 `phase-02/requirements/18-proto/00-REGISTRATION.md` | 无（待 phase-02 立项）|

⇒ 它们的路由在 `nav-reachability.config.json` 的 **`allowRoutes`** 里，
那份文件的注释 `//5` 逐字写着这是「**别的能力域/阶段（研究、问卷、大脑、任务）**」。
⚠ **这一节存在的原因**：2026-07-30 有一份原型通读报告把这四个域判为
「五个无主能力域，需人类补范围裁决」，据此差点在 phase-01 建出四份重复模块。
逐条更正见 [`../requirements/SCOPE-DELTA-2026-07-30.md`](../requirements/SCOPE-DELTA-2026-07-30.md) 第三节。
