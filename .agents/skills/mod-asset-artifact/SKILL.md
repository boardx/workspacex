---
name: mod-asset-artifact
description: >
  资产/产出物模块的活知识库：产出物（artifact）、文件（files）、资产与资产治理
  （asset/asset-governance）。动手改产出物生成、文件上传或资产权限治理之前必读。
  画布/图表（canvas/fabric-markdown/mermaid）不在本 skill 范围——那是官方
  Domain Skill mod-canvas-diagram（DOM-CANVAS-DIAGRAM，TPL-MOD-001 实例）的
  领地，去读它，不要在这里找画布知识。
---

# 资产/产出物（mod-asset-artifact） — 模块知识库

> 本文件是 asset-artifact 模块的**单一经验沉淀点**：每模块一个 skill，让任何
> 开发者（人类或 agent）都能持续迭代模块的 SOP/技巧/知识结构。读完你应该知道：
> 代码在哪、什么不能破坏、前人踩过什么坑。
>
> **历史与边界（2026-08-09 收敛）**：本 skill 原名 `mod-canvas-asset`，曾同时
> 覆盖画布与资产两块。官方 Domain Skill `mod-canvas-diagram`（H3A-018/#827，
> DOM-CANVAS-DIAGRAM 的 TPL-MOD-001 合规实例）落地后，画布/fabric-markdown/
> mermaid 的全部知识以它为唯一权威——本 skill 收窄到它**没有**覆盖的
> artifact/files/asset-governance，两边不再有重叠面。这次收敛本身就是一次
> "第二份事实副本"的现场清理：同一个域出现两份平行文档时，向官方治理机制
> （domains registry + TPL-MOD-001 schema + H3A-016 证据晋升）收敛，而不是
> 各写各的。

## 一句话定位
承载产出物（artifact）、文件（files）、资产及资产治理（asset/asset-governance）
——产品里"管理生成内容资产"这条主线的非画布部分；画布/图表见
`mod-canvas-diagram`（官方 Domain Skill）。

## 代码地图
- 页面：`apps/web/app/asset-governance`
- API 领域：`apps/api/src/application/{artifact,files,asset}`
  （对应 `apps/api/src/{infrastructure,domain}/{artifact,files}`；
  `asset` 目前仅在 application 层，治理逻辑以此为入口）
- 资产目录/文件字节的后端现状（fixture 假数据问题）见 issue #848 的调查记录：
  `apps/api/src/infrastructure/asset/fixture-asset-file-repository.ts`

## 关键契约与不变量（改代码前必读）
- <资产治理的权限模型——谁能看/改/删哪类资产，待核实具体实现>
- **资产文件字节今天没有真实持久化**：`fixture-asset-file-repository.ts` 文件头
  自述"截至 F141 内核里没有任何持久化存储存过 skill/agent 的真实文件字节"，
  目录浏览接口对任意 assetId 返回同一份 fixture——在这上面做"编辑真实内容"类
  feature 之前必须先解决持久化（见 #848、#598）。
- <公开面/未登录可达的资产相关端点清单——待核实>

## 架构知识
资产治理（asset-governance）与画布（canvas）在产品上相邻但在架构上正交：
画布的产出物落成 artifact 后进入资产生命周期，从那一刻起归本模块管（权限/
可见性/留存），画布怎么生成它归 `mod-canvas-diagram` 管。跨这条边界的 feature
（如"画布导出成资产"）需要两边的契约都读。

## 关联阶段 / ADR / 文档
`phases/`（按当前 sprint 的 active-features.json 定位相关 feature）；
issue #848（资产文件真实内容缺口）、#598（skill 双模型不收敛）

## 模块 SOP
1. 动手前：读本文件 + 对应 feature 的 `user_visible_behavior`/`verification`；跑
   `pnpm harness doctor --phase <相关 phase>` 确认没接手一个带审计债的现场。
2. 开发中：独立 worktree（ADR-005）；UI 改动跑 `lint-design.sh`；资产治理相关
   改动主动挂安全 review。
3. 交付：`verify --sprint` 门控；PR 描述里写清对上述契约的影响面。

## 踩坑与经验（append-only，最新在上）
- 2026-08-09：本 skill 曾与官方 `mod-canvas-diagram` 在画布域重叠（两份平行
  文档），已收窄范围完成收敛（出处：本次改动的 PR）。教训：建模块知识库前先查
  已有的 skill 清单（`project/PROJECT.md` 的模块清单），别按代码目录自行推演
  一套平行划分。（原文引的 .harness Domain registry 已随 H-01 删除——那套
  registry 全仓只有 1 条记录、0 个 TPL-MOD-001 实例，见 #1567。此处刻意不写
  成反引号路径，否则 skills doctor 会把它当成活引用再抓一次。）

## 知识回流规则（本文件怎么迭代——这是这个 skill 存在的意义）

1. **谁干活谁回流**：在本模块交付 feature/修 bug/做 review 时，踩到新坑、建立新做法、
   推翻旧假设 → 在同一个 PR（或紧随的小 PR）往上方"踩坑与经验"**追加**一条：
   `- YYYY-MM-DD：一句话结论（出处：PR/issue/postmortem 链接）`。append-only，不删旧条目
   （被推翻的旧经验标 ~~删除线~~ 并注明被哪条取代）。
2. **module coordinator 每 C-cycle 复盘**：检查本周期内本模块合并的 PR，有值得沉淀而
   没回流的，补写。
3. **结构变更**（新增章节/重组）走正常 review；追加"踩坑与经验"条目可随任意 PR 顺带。
4. 开源贡献者同权：任何人对本模块的经验修订都走 PR，以可验证事实为准，不看资历。
