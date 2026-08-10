---
name: mod-org-identity
description: >
  身份/组织/权限模块的活知识库：identity、auth、org-admin、security。动手改
  登录/会话、鉴权守卫、组织后台或安全相关逻辑之前必读——这是全站权限判断的
  唯一权威落点，任何模块新增鉴权都应复用这里而不是另起一套。
---

# 身份/组织/权限（mod-org-identity） — 模块知识库

> 本文件是 org-identity 模块的**单一经验沉淀点**：每模块一个 skill，让任何
> 开发者（人类或 agent）都能持续迭代模块的 SOP/技巧/知识结构。读完你应该知道：
> 代码在哪、什么不能破坏、前人踩过什么坑。

## 一句话定位
承载登录/会话/鉴权（identity/auth）、安全守卫（security）与组织后台
（org-admin）——是全站"谁能做什么"的唯一权威落点。

## 代码地图
- 页面：`apps/web/app/(entry)`（`join`/`auth`/`group`/`consent`/`login`/`session`）、
  `apps/web/app/org-admin`（`org-admin/preview`）、`apps/web/app/admin/[module]`
- API 领域：`apps/api/src/application/{identity,auth,security,org-admin}`
  （对应 `apps/api/src/{infrastructure,domain}/{identity,auth}`）
- 鉴权守卫：`apps/api/src/interface/guards`、`apps/api/src/interface/middleware`

## 关键契约与不变量（改代码前必读）
- **鉴权顺序**：新端点必须逐行复用 `apps/api/src/interface/guards` 里既有实现，
  禁止另起一套——这是全站唯一权威落点，其他模块（chat/canvas/research 等）的
  鉴权判断也应该复用这里，不要在各自模块里重新实现一遍判断逻辑。
- <会话/consent 的生命周期状态机——待核实，`apps/web/app/(entry)/{consent,session}`
  是入口，具体状态流转看代码不要猜>
- <公开面/未登录可达的页面与端点清单——待核实，任何改动过一遍未授权视角>

## 架构知识
这是全站鉴权的"上游"模块——[[mod-chat]]、[[mod-asset-artifact]]、
[[mod-research-studio]] 等所有模块的权限判断理论上都应该收敛到这里的 guards，
而不是各自维护一份判断逻辑（这正是本仓"单一事实源"原则在鉴权领域的应用）。
外部参照：WorkOS/Clerk 这类身份产品把"组织×成员×角色"建模成独立于业务领域的
一层，本仓 `org-admin` 的角色划分可以对照这个思路检查是否有跟具体业务模块
耦合过深的地方。

## 关联阶段 / ADR / 文档
`phases/`（按当前 sprint 的 active-features.json 定位相关 feature）

## 模块 SOP
1. 动手前：读本文件 + 对应 feature 的 `user_visible_behavior`/`verification`；跑
   `pnpm harness doctor --phase <相关 phase>` 确认没接手一个带审计债的现场。
2. 开发中：独立 worktree（ADR-005）；本模块几乎所有改动都算敏感 area，默认
   主动挂安全 review，不要等被要求。
3. 交付：`verify --sprint` 门控；PR 描述里写清对鉴权/权限面的影响面。

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
