---
name: mod-devportal
description: >
  开发者门户（devportal @ develop.boardx.us）的活知识库：协作平面的用户/项目/
  平台三块前端与其 BFF API。动手改门户的用户主页、项目页、平台管理页
  （coord-brain/dispatcher 可视化）或对应 API 路由之前必读。
---

# 开发者门户（mod-devportal） — 模块知识库

> 本文件是 devportal 模块的**单一经验沉淀点**：每模块一个 skill，让任何
> 开发者（人类或 agent）都能持续迭代模块的 SOP/技巧/知识结构。读完你应该知道：
> 代码在哪、什么不能破坏、前人踩过什么坑。

## 一句话定位
develop.boardx.us 的协作平面：面向工程师/agent 的项目页、个人主页与平台管理页
（coord-brain/dispatcher 可视化），是 [[mod-coord-platform]] 状态的人类可读窗口，
本身不持有协调状态。

## 代码地图
- 页面：`apps/devportal/app`（`portal`、`projects`/`projects/[slug]`、
  `platform`（`platform/coord-brain`、`platform/dispatcher`）、`u/[handle]`、
  `a/[handle]`、`onboard`、`explore`、`me`（`me/agents`）、`p`/`p/[slug]`）
- BFF API：`apps/devportal/app/api`（`api/portal`、`api/coord`、`api/p30`）
- 迁移背景：源码/CI/CD 唯一维护仓为本仓（自 #450 起），见 `apps/devportal/README.md`

## 关键契约与不变量（改代码前必读）
- **只读窗口，不是权威**：`api/coord`/`api/p30` 这两个 BFF 路由是
  [[mod-coord-platform]] 状态的转发/聚合层，不应该绕过 coord-platform 的
  DO/协议直接写协调状态——发现门户需要"改状态"而不只是"看状态"时，说明
  这个能力该加在 coord-platform 那边，不该加在门户 BFF 里。
- <公开面/未登录可达的门户页面清单——待核实，任何改动过一遍未授权视角>

## 架构知识
开发者门户类产品的常见架构（外部参照：Backstage）是"软件目录 + 插件化门户"，
插件各自拥有数据源，门户只做聚合展示。本仓 devportal 目前是非插件化的单体
路由结构（`portal`/`projects`/`platform` 直接对应固定页面，不是可插拔的插件
注册表）——如果未来要接入更多协调平面之外的数据源，值得对照 Backstage 的
插件模式评估是否要往插件化方向演进；现状下新增页面就是新增路由，不需要
先搭插件框架。

## 关联阶段 / ADR / 文档
`phases/`（按当前 sprint 的 active-features.json 定位相关 feature）；
`apps/devportal/README.md`（迁移背景）

## 模块 SOP
1. 动手前：读本文件 + 对应 feature 的 `user_visible_behavior`/`verification`；跑
   `pnpm harness doctor --phase <相关 phase>` 确认没接手一个带审计债的现场。
2. 开发中：独立 worktree（ADR-005）；UI 改动跑 `lint-design.sh`；跨到
   `api/coord`/`api/p30` 的改动先确认 [[mod-coord-platform]] 的协议契约。
3. 交付：`verify --sprint` 门控；PR 描述里写清对上述契约的影响面。

## 踩坑与经验（append-only，最新在上）
<空着开始。格式：`- YYYY-MM-DD：一句话结论（出处：PR/issue/postmortem 链接）`>

## 知识回流规则（本文件怎么迭代——这是这个 skill 存在的意义）

1. **谁干活谁回流**：在本模块交付 feature/修 bug/做 review 时，踩到新坑、建立新做法、
   推翻旧假设 → 在同一个 PR（或紧随的小 PR）往上方"踩坑与经验"**追加**一条：
   `- YYYY-MM-DD：一句话结论（出处：PR/issue/postmortem 链接）`。append-only，不删旧条目
   （被推翻的旧经验标 ~~删除线~~ 并注明被哪条取代）。
2. **module coordinator 每 C-cycle 复盘**：检查本周期内本模块合并的 PR，有值得沉淀而
   没回流的，补写。
3. **结构变更**（新增章节/重组）走正常 review；追加"踩坑与经验"条目可随任意 PR 顺带。
4. 开源贡献者同权：任何人对本模块的经验修订都走 PR，以可验证事实为准，不看资历。
