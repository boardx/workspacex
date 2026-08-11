---
name: mod-project
description: >
  project 模块（项目容器：三类容器 / 议程环节 / 项目成员 / 项目工作台）的知识库。
  做 /projects、/project/new、/projects/[projectId] 六个 tab、以及 project 束后端
  （createProject / listProjects / overview / archive / agenda-segments / members）
  的活之前先读它：代码在哪、什么不能破坏、前人踩过什么坑。
---

# 项目容器（project） — 模块知识库

> 本文件是 project 模块的**单一经验沉淀点**。读完你应该知道：代码在哪、
> 什么不能破坏、前人踩过什么坑。

## 一句话定位

「项目」是本产品的顶层容器；本模块负责它的**生命周期与骨架**——三类容器的创建/列出/归档、
议程环节状态机、项目成员与两层角色，以及项目工作台那一屏的壳。容器**里面**的东西
（画布、录音、访谈、文件、对话）各有自己的模块，不在这里。

## 代码地图

- 页面：`apps/web/app/projects/`（列表 + `[projectId]` 工作台）、`apps/web/app/project/new/`（新建向导）、`apps/web/app/project/live/`（F122 留下的最小真实路径）
- 组件：`apps/web/components/projects/projects-screen.tsx`（列表）、`apps/web/components/project/`（向导、工作台、六个 tab）
- 前端 API 薄封装：`apps/web/lib/live-projects.ts`（**类型一律从 `@repo/contracts` 推导，不另声明**）
- API：`apps/api/src/interface/controllers/project.controller.ts`、`apps/api/src/application/project/`、`apps/api/src/infrastructure/project/pg-*.ts`
- 契约（唯一事实源）：`packages/contracts/src/project.ts`
- mock（六 tab 共用的 33KB 热点）：`apps/web/lib/mock/project.ts`

## 关键契约与不变量（改代码前必读）

- **三类独立容器**：`projects` 是超类型（只有 id/org_id/name/status/kind），`workshops` /
  `research_projects` / `user_insights` 三张 1:1 子类型表承载行为。互斥由
  `UNIQUE(id, kind)` + 复合外键**在数据库层**保证，不是靠大家小心。父子项目模型（Q-12 候选 E）**已判负**。
- **`deleteProject` 不存在**。它的交付物是一条断言它不存在的测试。归档不删除任何东西，
  生命周期恰好两态（`active` / `archived`）。
- **只有组织角色 `lead` 能建项目**。`admin` **不能**（U-4 裁 A，与「管理员不是超级用户」同向）——
  写测试/种子时别顺手把 admin 升成 lead，那会把这条已裁边界从门控里抹掉，而抹掉后一切照样全绿。
- **创建不自动授予项目角色**（Q-4②）。所以建完项目的人能在 `listProjects` 的 **managed** 段
  看见它，却拿不到 `GET /projects/:id/overview`（403）——**这是对的，不是缺陷**。
- **`listProjects` 两段式返回**（member / managed），不是一个混合数组加 `canManage` 布尔。
- **同一工作坊内 `active` 议程环节至多一个**，落成 DB 部分唯一索引。
- **概览不带准备度百分比**：分母表无出处（`KNOWN_CONTRACT_GAPS.P6`）。在别处编一个分母就是第二份事实。
- 前端只渲染**契约真有的字段**。原型卡片上的 `readiness` / `stageProgress` / `owner` / `priority`
  全部没有出处，接真栈时**如实收窄**，不补一个「看起来算过的数」。

## 关联阶段 / ADR / 文档

- `phases/phase-01-run-a-project/contracts/project/`（domain.md / usecases.md / ui.md / design-signoff.md）
- `phases/phase-01-run-a-project/requirements/00-project/`（uc-00-1 领域模型 / uc-00-2 列表与主页 / uc-00-3 成员与角色）
- 原型参照图：`phases/phase-01-run-a-project/ui-preview/project-v2/`（92 张 8 屏）
- ADR-020 / ADR-023（契约单源与签核门）

## 模块 SOP

1. 动手前：读本文件 + 该 feature 的 `user_visible_behavior`/`verification`；确认所属契约束已签核。
2. 开发中：独立 worktree；**mock→真栈的改动串行**（`lib/mock/project.ts` 是六 tab 共用热点，
   两个分支同时动它必冲突）。
3. 交付：真栈 e2e 证据 + 反证；`verify --sprint` 门控；PR 写清对上述不变量的影响面。

## 踩坑与经验（append-only，最新在上）

- 2026-08-12：**前端接线的真栈证据要挂在 `playwright.fullstack-smoke.config.ts` 的 `seeded`
  project 上，并单独成 spec 文件**——不要并进 `fullstack-smoke.spec.ts`：那个文件的每条
  `page.goto` 被 `.harness/scripts/fullstack-smoke.test.ts` 按**出现次数**钉死（#387 的反空转手段），
  加一行登录就会让那些计数失效，而唯一让它变绿的改法是去放宽 #387 的门控。
  新 spec 记得同时加进 config 的 `testMatch`，否则 playwright 报 "No tests found" 而不是报错。
  （出处：[PR #980](https://github.com/boardx/workspacex/pull/980)）
- 2026-08-12：**建完项目打开工作台，`GET /projects/:id/overview` 返回 403 是正确行为**
  （Q-4②「创建不自动授予项目角色」）。别把它当 bug 修；e2e 里断言「403 恰好只有 overview 这一条」，
  不要把 403 一律放过——后者会让任何新出现的越权拒绝从此静默。
  （出处：[issue #976](https://github.com/boardx/workspacex/issues/976)）
- 2026-08-12：**「接后端」不等于把界面上每个控件都接上**。`createProject.in` 是 `.strict()` 的
  四个字段，向导上的时长档位/日期时间/参与人数/关联研究来源它一个都收不到。正确处置是
  **只读展示 + 明写「本版不写入后端」**，不是画成可填输入框（填了像存了）也不是删掉
  （已签核的界面凭空少一块）。蓝本九宫格同理：契约签了但后端零实现 → 整体禁用 + 明示原因。
  （出处：[PR #980](https://github.com/boardx/workspacex/pull/980)）
- 2026-08-12：**失败后按钮必须恢复可点**。向导旧实现「点一次就永久禁用」是把幂等
  （后端 `idempotencyKey` 的事）错做到了界面层，结果遇到 403/网络错误的人再也建不了项目。
  界面层只需保证「提交进行中不发第二个请求」。
  （出处：[PR #980](https://github.com/boardx/workspacex/pull/980)）
- 2026-08-12：**别用 `cmd | grep ...` 判断 cmd 成不成功**——`$?` 是 grep 的退出码，
  grep 匹配到就是 0。我因此在 issue 上写了一句「基础验证 exit 0」的错话，实际它 exit 1。
  要判定用 `cmd > log 2>&1; echo $?`。（出处：[issue #976](https://github.com/boardx/workspacex/issues/976)）

## 知识回流规则（本文件怎么迭代——这是这个 skill 存在的意义）

1. **谁干活谁回流**：在本模块交付 feature/修 bug/做 review 时，踩到新坑、建立新做法、
   推翻旧假设 → 在同一个 PR（或紧随的小 PR）往上方"踩坑与经验"**追加**一条：
   `- YYYY-MM-DD：一句话结论（出处：PR/issue/postmortem 链接）`。append-only，不删旧条目
   （被推翻的旧经验标 ~~删除线~~ 并注明被哪条取代）。
2. **module coordinator 每 C-cycle 复盘**：检查本周期内本模块合并的 PR，有值得沉淀而
   没回流的，补写。
3. **结构变更**（新增章节/重组）走正常 review；追加"踩坑与经验"条目可随任意 PR 顺带。
4. 开源贡献者同权：任何人对本模块的经验修订都走 PR，以可验证事实为准，不看资历。
