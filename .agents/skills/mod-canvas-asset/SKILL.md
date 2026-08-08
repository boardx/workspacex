---
name: mod-canvas-asset
description: >
  Canvas/资产模块的活知识库：白板画布（canvas）、产出物（artifact）、文件
  （files）、资产与资产治理（asset/asset-governance）。动手改画布渲染、产出物
  生成、文件上传或资产权限治理之前必读。
---

# Canvas/资产（mod-canvas-asset） — 模块知识库

> 本文件是 canvas-asset 模块的**单一经验沉淀点**：每模块一个 skill，让任何
> 开发者（人类或 agent）都能持续迭代模块的 SOP/技巧/知识结构。读完你应该知道：
> 代码在哪、什么不能破坏、前人踩过什么坑。

## 一句话定位
承载白板画布（canvas）与其产出物（artifact）、文件（files）、资产及资产治理
（asset/asset-governance）——产品里"生成并管理内容资产"这条主线。

## 代码地图
- 页面：`apps/web/app/canvas`、`apps/web/app/asset-governance`
- API 领域：`apps/api/src/application/{canvas,artifact,files,asset}`
  （对应 `apps/api/src/{infrastructure,domain}/{canvas,artifact,files}`；
  `asset` 目前仅在 application 层，治理逻辑以此为入口）
- Markdown/图表转换：`packages/fabric-markdown`（vendored fork，见 ADR-100，
  改动前确认是否该改上游而不是本仓）

## 关键契约与不变量（改代码前必读）
- <资产治理的权限模型——谁能看/改/删哪类资产>
- <画布产出物与 artifact 存储的一致性假设>
- <公开面/未登录可达的画布/资产相关端点清单>

## 关联阶段 / ADR / 文档
`docs/adr/ADR-100-fabric-markdown.md`；`phases/`（按当前 sprint 的
active-features.json 定位相关 feature）

## 模块 SOP
1. 动手前：读本文件 + 对应 feature 的 `user_visible_behavior`/`verification`；跑
   `pnpm harness doctor --phase <相关 phase>` 确认没接手一个带审计债的现场。
2. 开发中：独立 worktree（ADR-005）；UI 改动跑 `lint-design.sh`；资产治理相关
   改动主动挂安全 review。
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
