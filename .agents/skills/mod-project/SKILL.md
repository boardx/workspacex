---
name: mod-project
description: >
  Use when 项目改动涉及 /projects、/project/new、/projects/[projectId] 工作台，
  或 createProject / listProjects / overview / archive / agenda-segments / members API。
---

# 项目容器（project） — 模块知识库

> 本文件是 project 模块的**单一经验沉淀点**。读完你应该知道：代码在哪、
> 什么不能破坏、前人踩过什么坑。

## 一句话定位

「项目」是本产品的顶层容器；本模块负责它的**生命周期与骨架**——项目容器的创建/列出/归档、
议程环节状态机、项目成员与两层角色，以及项目工作台那一屏的壳。容器**里面**的东西
（画布、录音、访谈、文件、对话）各有自己的模块，不在这里。

## 代码地图

- 页面：`apps/web/app/projects/`（列表 + `[projectId]` 工作台）、`apps/web/app/project/new/`（新建向导）、`apps/web/app/project/live/`（F122 留下的最小真实路径）
- 组件：`apps/web/components/projects/projects-screen.tsx`（列表）、`apps/web/components/project/`（向导、工作台、六个 tab）
- 前端 API 薄封装：`apps/web/lib/live-projects.ts`（**类型一律从 `@repo/contracts` 推导，不另声明**）
- API：`apps/api/src/interface/controllers/project.controller.ts`、`apps/api/src/application/project/`、`apps/api/src/infrastructure/project/pg-*.ts`
- 契约（唯一事实源）：`packages/contracts/src/project.ts`
- mock：**已无**——#4358 删除了项目工作台全部 mock 数据（改真实数据或如实空态），
  `apps/web/lib/mock/project.ts` 不复存在<!-- skill-doctor:ignore：这里正是在说明该路径已不存在，不是声称它存在 -->

## 关键契约与不变量（改代码前必读）

- **容器种类与存储以当前契约/实现为准**：`packages/contracts/src/project.ts` 的 `ProjectKind`
  当前为 `workshop` / `general`；旧研究项目、用户洞察已合入通用项目。不要按旧三类笔记扩张类型。
- **`deleteProject` 不存在**。它的交付物是一条断言它不存在的测试。归档不删除任何东西，
  生命周期恰好两态（`active` / `archived`）。
- **组织 `lead` 与 `admin` 都能创建项目**：权限单源是 `create-project-rules.ts#canCreateProject`，
  2026-08-06 人类裁决 / #608 已覆盖旧 U-4「只有 lead」。这不授予管理员对其它项目的内容超级权限。
- **创建者自动获得对应容器的最高项目角色**：当前落点在 `pg-project-repository.ts#create`，
  工作坊写 facilitator + host，通用项目写 owner；这是后续裁决推翻旧 Q-4② 后的实现，不能按旧 403 笔记回退。
- **列表是扁平数组**：以 `listProjects.out` 和 `ProjectsScreen` 为准；旧 member / managed 两段式已被 F185 取代。
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
2. 开发中：独立 worktree；原「mock→真栈的改动串行」约束的前提（`lib/mock/project.ts` 是
   六 tab 共用热点）已随 #4358 删除该 mock 而消失——改动直接落在真实数据路径与组件上。
3. 交付：真栈 e2e 证据 + 反证；`verify --sprint` 门控；PR 写清对上述不变量的影响面。

## 踩坑与经验（append-only，最新在上）
- 2026-11-07: Shared UI status types must depend directly on canonical contracts, not API adapters with mock imports: lint-ui-wiring follows type-only edges too. Derive interview status from interview.DigitalInterviewStatus and keep project reachability clean without exemptions (issue #6377 / PR #6378).

- 2026-11-06：项目列表的成员入列必须按 `projects.kind` 读取对应身份表：工作坊用 `project_memberships`，通用项目用 `general_project_members`。邀请接受已经持久化后一律不靠前端缓存补列表；仅查询前者会导致协作者能进工作台、返回列表却消失。两支都限定 actor + project + org，保留管理段去重和只读标注；真实邀请→独立数据库读→列表、浏览器返回/刷新/新会话回归见 issue #6339。

- 2026-11-03：国际化开工核对发现本文件旧的三种 kind、创建者不授角色、两段列表及 admin 不能创建已落后于代码。
  以 `ProjectKind` / `listProjects.out`、`canCreateProject`、`PgProjectRepository.create` 及真实创建测试为准，
  修正当前约束；下方 2026-08-12 403 记录仅为当时历史，已被 2026-08-16 后续裁决推翻，不能当当前验收。
  （出处：[issue #6160](https://github.com/boardx/workspacex/issues/6160)，本批只改显示，不改权限。）


- 2026-10-02：W1 general 迁移删除旧 subtype/member 表并改 kind；旧生产代码实际引用这些表，
  镜像回滚不能恢复 schema。发布必须绑定 exact baseline/target/pending plan 的旧新读写证据；
  局部 SQL fixture 检出不兼容不能冒充 restored runtime 验收。见
  [兼容发布说明](docs/deployment/cn-project-migration-compatibility.md)（出处：[issue #5097](https://github.com/boardx/workspacex/issues/5097)）。

- 2026-10-01：空前缀同源代理的 `GET /projects` 与静态页面同名，`afterFiles`
  到不了 API；仅对 `Accept: application/json` 在 `beforeFiles` 代理集合端点，
  HTML 导航与 RSC 请求仍走项目页面。列表失败统一用 `StateShell dep-failed`，
  不展示原始解析/网络诊断。（出处：[issue #930](https://github.com/boardx/workspacex/issues/930)）

- 2026-10-01：本文件此前引用过已被 #4358 删除的 mock 路径 `apps/web/lib/mock/project.ts`<!-- skill-doctor:ignore：就是在说它已不存在 -->，
  引用一直没跟着更新——被 `pnpm harness skills doctor` 的「失效路径引用」门控
  抓到并修正。删文件 / 挪位置时，**同一个 PR 里更新 `.agents/skills/**` 的引用**（门控只查
  存在性，语义是否过时仍要人读）。
  （出处：[PR #4894](https://github.com/boardx/workspacex/pull/4894)）
- 2026-09-13：`agenda_segments.duration` 自 F23 起允许 `NULL`，表示蓝本 `flow-agenda`
  没有填写真实时长；所有共享输出契约和生成的 runtime schema 都必须保留这个空值，不能继续按
  正整数解析，否则 `wx_project_read` 会在已有项目上失败。（出处：[issue #3571](https://github.com/boardx/workspacex/issues/3571)）
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
