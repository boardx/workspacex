# `chat` 束 · 迁移影响面 —— #594 把「对话恒属于项目」这条不变量推翻了

> 本文只登记影响面与风险，不改任何代码、不改 `design-signoff.md` 的 `status`。
> 与 `project` 束同名文件同一种用途（见其头注对本仓「签核动作 vs 实现动作」的区分）。

## 一、这是什么，为什么不是一次普通的放宽

`domain.md`（本束支撑材料，`design-signoff.md` `status: confirmed`，
`confirmed_by: yanbin shen`，`confirmed_at: 2026-07-30T16:50:06+08:00`，
覆盖 F108–F115）第一行逐字写着：

> `projectId` | 恒非空——**对话不存在于项目之外**（含 agent 私聊，见 I-9）

以及 I-9：

> agent 私聊的 `ownershipLayer` 恒为 `project`，**永不为 `personal`**（O-24）。

这两条是**已签核的不变量**，不是实现细节。2026-08-06，人类本人在 devapp 上实际使用
时撞到「请先选择项目」的空态，直接推翻：

> 「不需要新建项目也应该新建一个 chat，开始使用 skills 和 agent」

coord-chat-e2e 当场问清范围（方案 A：`projectId` 全链路可空 / 方案 B：隐式默认项目），
**人类明确选 A**。coord-main 接受推翻、不重新论证，视为签核已完成——这是人类本人
直接、明确的方向确认，等价于走一轮 design-delta，只是没有另开一份文档流程。

⚠ **这条推翻了什么，没推翻什么**：
- 推翻：「对话恒属于项目」这条**结构性**不变量。
- **没有**推翻 I-9：I-9 讲的是 **agent 私聊**（`agent_private = true` 的那一类线程）
  恒属项目层——本次新增的「个人线程」是完全不同的一类东西（`agent_private` 恒
  `false`，`ownership_layer` 列不动，见下）。agent 私聊今天依旧只能在项目内发起，
  这条边界完整保留，**不受本次改动影响**。

## 二、契约面变更（`packages/contracts/src/chat.ts`）

| 操作 | 变更 | 风险 |
|---|---|---|
| `resolveVisibility.in.projectId` | `z.string()` → `z.string().nullable()` | 🟡 低（纯放宽，`null` 有新的显式分支处理，不会被现有调用方意外传出） |
| `getThread.out.thread.projectId` | `z.string()` → `z.string().nullable()` | 🟠 中（下游任何假设「这个字段恒有值」的前端代码会在个人线程上拿到 `null`，见「三、前端影响面」） |
| `listPersonalThreads`（新操作） | 新增，`GET /chat/threads` | 🟡 低（新增操作不影响既有调用方；path 与既有 `listThreads` 的 `/chat/projects/:projectId/threads` 在段数上不同，不冲突） |
| `mutateThread.in.projectId` | **不变** | 🟢 无风险——它从 F109 落地起就是 `z.string().nullable()`，矛盾一直只在实现侧（`mutate-thread.ts` 单方面拒绝 `null`），见下节 |
| `ChatVisibility` 五值 | **不变** | 🟢 无风险——个人线程复用既有 `private`，五值封闭这条不变量原样成立，只是 `private` 的文案覆盖面从「研究阶段」扩到「研究阶段∪无项目」 |

### 2.1 一个值得记录的事实：这条矛盾本来就在契约里，只是没人处理

`mutateThread.in.projectId` **从第一版契约起就是 `z.string().nullable()`**——查
`packages/contracts/src/chat.ts` 的 git 历史，这个字段没有被本次改动碰过。真正拒绝
`null` 的是 `apps/api/src/application/chat/mutate-thread.ts` 里一行 `if (projectId
=== null) throw new ThreadNotVisibleError()`（#602 那次分析已经点出，见其 PR 正文
「契约允许 null / 实现拒绝 null」一节）。

⇒ 这意味着**契约签核时这条口子就没堵严**：签核人当时确认的 `③ API 契约` 允许
`projectId: null` 传进来，而 `② 用例`/`domain.md` 却说「恒非空」——两者当时就不一致，
只是没有任何调用方去踩这条缝，直到 #594 把它变成了产品要求。#594 没有制造新的矛盾，
是**兑现**了一个已经签在契约里、此前被实现单方面拒绝的口子。

## 三、前端影响面（`apps/web`）——**未验证，登记为风险，不是结论**

本 PR 的实现范围以后端为主（详见 PR 正文），前端只做了最小的、可组件测试覆盖的改动
去满足 #594 验收「无需创建任何项目，直接进 /chat 就能新建会话」。以下是**已知但未逐条
验证**的前端影响面，供下一个碰这段代码的人核对：

- 🟠 任何读 `getThread.out.thread.projectId` 后直接拼 URL（例如
  `/projects/${thread.projectId}/...`）或直接传给要求非空 `projectId` 的其它契约调用
  （如 `queryChatAuditEvents` 的 path `/chat/projects/:projectId/audit-events`）的组件，
  遇到个人线程时 `projectId` 会是 `null`，若没有判空会在运行时构造出 `/projects/null/...`
  这类畸形请求。`grep -rn "thread.projectId" apps/web` 是下一步排查的起点。
- 🟡 `apps/web/lib/mock/chat.ts` 一类 mock 数据可能默认给 `projectId` 一个非空字符串，
  个人线程的空态/mock 场景需要单独补，不在本次范围内。

## 四、数据库变更（见迁移 `20260806100000_i594_personal_threads.sql`）

- `chat_threads.project_id` DROP NOT NULL。FK 本身对 NULL 天然放行，不需要改 FK 定义。
- 新增局部索引 `chat_threads_personal_idx`（`WHERE project_id IS NULL`），不与既有
  `chat_threads_project_idx` 重叠。
- **不动**：`ownership_layer`（恒 `'project'`，该列唯一声明用途是 I-9，
  应用层代码从未读取它，动它是修一个没有消费者会感知到的列，风险收益不成比例，
  已在迁移文件内如实记录、留给后人评估）、`agent_private`（个人线程恒 `false`）、
  `chat_threads_visibility_scope` / `chat_threads_member_private_needs_group` 两条 CHECK
  （个人线程恒 `visibility_scope='private'`，不触碰 `member-private` 那一档）。
- **自动生效、未显式验证**：F124 的 `kernel_apply_project_archive_policies()`
  按 pg_catalog 扫描出「单列 FK 指向 `projects`」的表并生成
  `WITH CHECK (project_id IS NULL OR kernel_project_is_writable(project_id))` 这样的
  RESTRICTIVE 策略——`chat_threads` 在这次改动前就满足这个条件（FK 一直都在，只是列曾是
  NOT NULL），所以这条策略**已经**是「`project_id IS NULL` 天然放行」的写法，本次
  DROP NOT NULL 不需要重新生成任何策略。这是**推理**，本 PR 没有另写一条测试断言
  「个人线程不受项目归档冻结影响」——登记为未验证项，供下一个碰这块的人补。

## 五、影响 passing 状态的既有 feature

F108（可见性判定）覆盖的既有测试套件（`visibility-two-layer-intersection.test.ts`
等 24 个 chat 测试文件，175 条测试）在本次改动后**全部重跑并保持绿**——项目分支的
判定代码逐字节未改，只是新增了一个 `if (projectId === null)` 分岔在最前面。
这不是「因为没测所以没坏」，是本 PR 反证套件的一部分，证据见 PR 正文。
