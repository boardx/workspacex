# 契约 delta（待签核）—— 会话归档（可逆），修订已签束 `chat`

> ⚠ 本文件是 **ADR-023 contract-delta 登记**，不是签核。`design-signoff.md` 的
> `covers:`/`status:` 一个字没动——那是人类专属的动作，本文件也没有改任何一个
> `status` 字段。参照同目录 `agui-bridge-delta-pending.md` 的先例格式，以及
> 2026-08-11 `chat-file-upload`/`chat-context-engine` 两束"小 delta 修订"先例
> （PR #927）——本次不新开一个契约束，是**修订已签束 `chat`**（frontmatter
> `status: confirmed`，2026-07-30 由 yanbin shen 签，`covers: [F108...F115]`）。
>
> **实测基线**：`origin/main` @ `d88e7693`（2026-08-26 `git fetch` 后实测；早于此
> SHA 的说法一律以此为准，不重复标注每一处）。

## 缺口从哪来（如实登记，不是新发现）

`copilotkit-v2-shell.tsx:143-176` 头注（issue #2053 CK-P8）已经把这条缺口写在
代码里："`chat_threads.archived` 真实存在、`getThread` 真实下发 ⇒ 只读态接的是
真数据。但 `mutateThread.in.op` 只有 `create | rename | delete`——契约里没有
archive 操作……且 `ThreadCard` 没有 `archived` 字段，左栏无法给归档线程加标记。
两处缺口都需要契约新增 + 签核，本 issue 不擅自加。" 本文件就是那次登记承诺的
后续。

实测确认（`packages/contracts/src/chat.ts`）：
- `:545` `mutateThread.in.op = z.enum(["create","rename","delete"])`——无
  archive/unarchive。
- `:335-347` `ThreadCard`——无 `archived` 字段。
- `:454` `getThread.out.thread.archived: z.boolean()`——**已存在**，只读态已通。
- `:207` `ChatError` 已有 `THREAD_ARCHIVED_READONLY`——归档线程的"写全部被拒"
  语义**已经是本束现有契约的一部分**，只是至今没有任何写操作能把线程*变成*
  归档态。
- `:525,561` `listThreads`/`listPersonalThreads.in.includeArchived?: boolean`
  **已存在**——列表侧的"要不要看归档线程"开关已经有了，缺的只是"怎么让线程
  进入归档态"与"卡片上怎么标出来"。

现有「删除」是**不可逆硬删除**（`thread-list-shell.tsx` hover「…」菜单
`mode:"deleting"` 态，要求填 `reason`，走 `expectedVersion` 乐观并发，返回
`impactScope` 且必写审计）。**归档要的是可逆语义，与删除不是同一个动作**，
不能复用同一个 `op`。

---

## ① API 契约 —— `packages/contracts/src/chat.ts` 修订面

### 1a. `ThreadCard` 加 `archived: boolean`

```ts
export const ThreadCard = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  badges: z.array(MessageBadge),
  status: ThreadCardStatus,
  artifactCount: z.number().int().nonnegative(),
  lastActivityAt: z.string(),
  visibilityScope: ChatVisibility,
  archived: z.boolean(),          // 🆕 本 delta
}).strict();
```

服务端已经持有这个值（`chat_threads.archived`，`getThread` 已在下发），这里
只是把**同一个既有事实**在列表读端口也投影一次——与 `getThread.out.capabilities`
在 `listThreads.out` 里同样下发一次是同一个理由（#489 先例，见
`operations.listThreads` 头注）。不是新增服务端语义，是把已有事实补齐第二个
读端口。

### 1b. `mutateThread.in.op` 枚举扩容 —— **待人类选（见下方决策 ①）**

候选 A（推荐）：加两个值，`archive`/`unarchive`，与 `create`/`rename`/`delete`
同级并列：

```ts
op: z.enum(["create", "rename", "delete", "archive", "unarchive"]),
```

候选 B：不扩容枚举，改用 `op: "archive"` + 新增 `archived: z.boolean().nullable()`
字段做状态翻转（复用同一个 op，靠 `archived` 参数区分方向）。

两者的 `out`/`err` 形状不变：仍是 `{ threadId, version, auditEventId,
impactScope }` / `NOT_VISIBLE | NO_WRITE_ROLE | VERSION_CHANGED |
THREAD_ARCHIVED_READONLY | TITLE_INVALID | AUDIT_SINK_UNAVAILABLE`——
`impactScope` 对 archive/unarchive 恒为 `null`（不是删除那种"影响范围"语义，
归档不影响任何下游引用/血缘）。

**幂等语义（不是待裁决项，直接定为设计约束）**：对已归档线程再次 `archive`、
或对未归档线程 `unarchive`，视为幂等重放——`expectedVersion` 匹配当前版本时
返回同一个 `auditEventId`、不产生第二条审计、`version` 不递增；这与 `delete`
现有的"同 `expectedVersion` 的重复 delete 返回同一 `auditEventId`"逐字同一个
纪律（`usecases.md:107`），不新发明一套。

### 1c. `THREAD_ARCHIVED_READONLY` 对 `archive`/`unarchive` 自身**不适用**

⚠ 容易踩的坑：这个错误码现在的语义是"线程已归档 ⇒ 别的写操作全部被拒"。
如果对 `archive`/`unarchive` 操作本身也套用它，会出现"归档的线程连'取消归档'
都做不了"的死锁。**`unarchive` 必须是 `THREAD_ARCHIVED_READONLY` 语义下唯一
被放行的写操作**——契约层用一句显式注释标注，不能靠实现者自己猜。

### 1d. 归档正在运行的会话要不要拦 —— **待人类选（见下方决策 ②）**

`mutateThread` 当前完全不感知"这条线程是否有活跃 run"——`create`/`rename`/
`delete` 都不检查。归档要不要成为第一个检查这件事的操作，是本次唯一的新增
判断面，三个候选见下方决策表。

---

## ② 用例层 —— 归档/取消归档的完整流程

**谁能操作**：与现有 `rename`/`delete` 同一判权路径——`NO_WRITE_ROLE` 复用
既有 `capabilities` 判定（`thread.mutate`），不新增角色维度。观察者恒无写权，
这条不变（I-3 同源）。

**并发**：与 `rename`/`delete` 同一套 `expectedVersion` → `VERSION_CHANGED`
乐观并发（V7 的自然延伸），不新造第二套并发协议。

**审计**：`archive`/`unarchive` 各产生一条审计事件（同 `mutateThread` 现有
"新建/改名/删除线程"审计覆盖面，`usecases.md:399` 那一行需要同步加上
"归档/取消归档"六个字——见下方③附带修订）。

**UC 新增（草案编号 UC-6，紧随现有 UC-5 新建/改名/删除线程之后）**：

```
UC-6: 归档 / 取消归档线程
  in:  archive   { actorId, threadId, expectedVersion }
       unarchive { actorId, threadId, expectedVersion }
  out: { threadId, version, auditEventId, impactScope: null }
  err: NOT_VISIBLE | NO_WRITE_ROLE | VERSION_CHANGED
       | AUDIT_SINK_UNAVAILABLE
       [| 决策②选 B 时追加 ACTIVE_RUN_IN_PROGRESS]
```

- **归档后原有能力**：线程仍可被 `getThread` 读取（`archived: true`），仍受
  `THREAD_ARCHIVED_READONLY` 保护——这条在 `chat` 束里已经生效（`getThread`/
  `mutateThread` 的 err 列表已经带这个码），本次不新增该错误码的适用范围，
  只是新增了"能把线程真正置于该状态"的写入口。
- **列表可见性**：`listThreads`/`listPersonalThreads` 的 `includeArchived`
  开关已存在（`:525,561`），默认行为"归档线程不返回"（I-15 现有措辞）不变；
  归档/取消归档操作本身**不**改变这条默认值的语义，只是让开关背后终于有真实
  数据可切换。

---

## ③ UI 层 —— hover 动作组新形态（本次只出契约文档，不画原型）

现状（`thread-list-shell.tsx` 四态状态机 `view/menu/editing/deleting`）：
「…」菜单里是**图钉 / 改名 / 删除**三个动作，`mode==="deleting"` 态要求填
`reason` 才能提交。

新增「归档」后要不要保留「删除」、以什么形态保留，是本次**唯一需要收窄成
选择题**的 UI 决策（下方决策 ③）。状态机层面：新增 `mode: "archiving"` 还是
复用 `mode: "deleting"`（归档不需要填 `reason`，复用会多出一个恒不用的字段）
是实现细节，**推荐新增独立 `archiving` 态**——`deleting` 态的 `reason` 输入框
对归档语义是死代码，复用会造出"一个态两种表单形状"的分支，属于本仓已经
在四态注释里强调过的"不要多头实现同一件事"的反面。这条不升级为人类决策题，
按推荐直接定。

字段层面的 UI 依据已经在①1a 里定了（`ThreadCard.archived`）——卡片本身需要
一个视觉标记（如次要文案"已归档"或图标），具体视觉不在本轮出，等契约字段
定下来、决策③选定后再补 `ui-preview/` 截图。

---

## ④ 跨束交叉复核

检查了 `phases/phase-01-run-a-project/contracts/plan-control/` 全部四份材料
（该束自身也是**未签核状态**，活在 `signoff/plan-editing` 分支，尚未合入
`origin/main`——不是本次 delta 修改对象，只是交叉读取核对有没有冲突假设）：

- `usecases.md:33,116,130,147,164` —— `plan-control` 束的四个写用例（编辑步骤/
  加约束/调序/删步骤）**已经**把 `THREAD_ARCHIVED_READONLY` 列进各自 `err`
  分支。说明"归档 ⇒ 计划编辑也被拒"这条不变量**在对方束里已经被正确假设**，
  不需要本次改动去补——本次只是补上"归档"这个动作本身的写入口，`plan-control`
  侧不需要跟着改。
- `domain.md` 通篇没有任何处假设"线程一定不是归档态"，`PlanLedger`/
  `PlanPhase`/`RunControlAction` 都不读 `chat_threads.archived` 字段——两束
  之间没有反向依赖，本次 delta **不会**让 `plan-control` 的任何不变量失真。
- 唯一需要留意但不阻塞的一点：`plan-control` I-12 的 `pause` 语义（暂停一个
  活跃 run）与本文件决策②如果选中"归档要拦活跃 run"，**判断"是否存在活跃
  run"这件事最好是同一个事实源**——不要 `chat` 束和 `plan-control` 束各自
  查一遍"这条线程是否有活跃 run"，那会是本仓第六次"同一事实声明在两处"。
  见下方决策②选项 B 的代价栏。

结论：**没有发现会被本次 delta 打破的既有假设**，`plan-control` 侧不需要
跟着修订。

---

## 待人类裁决的点（收窄成选择题）

### ① `mutateThread.in.op` 该怎么扩容

| 候选 | 怎么做 | 支持 | 代价 |
|---|---|---|---|
| **A（推荐）** | 加两个枚举值 `archive`/`unarchive`，与现有 `create/rename/delete` 并列 | 与既有三个动作同一种设计语言，审计事件类型可以直接叫"归档"/"取消归档"，不需要额外读一个布尔参数才知道方向；`err`/`out` 形状零改动 | 枚举多两个值 |
| B | 复用单一 `op:"archive"` + 新增 `archived: boolean` 参数做翻转 | 枚举少两个值 | 前端每次都要显式传 `archived: true/false`，容易漏传/传反；审计事件类型要从"op + archived 字段"两处拼出来，不是单一事实 |

### ② 归档一个正在运行会话要不要拦

| 候选 | 怎么做 | 支持 | 代价 |
|---|---|---|---|
| A（推荐） | 不拦。归档随时可执行；归档只阻断*未来*的用户写操作（`THREAD_ARCHIVED_READONLY` 既有语义），不中断已经在飞的 run——run 该怎么跑完还怎么跑完，写入路径是服务端内部通道，不经过 `mutateThread` | 零新增判断面，复用现有"archived 只挡用户写、不挡系统写"的既有实现事实（`getThread` 对归档线程正常返回、不抛错，说明读侧从来没把 archived 当"完全冻结"） | 用户可能在 agent 还在打字时把线程归档，短暂出现"已归档但列表右上角还在转圈"的观感，不算数据错误，是一个 UX 细节 |
| B | 拦。存在活跃 run 时归档返回新错误码 `ACTIVE_RUN_IN_PROGRESS`，要求用户先等 run 结束（或走 plan-control 的 `pause`）才能归档 | 语义更"干净"：归档态下线程真的完全静止 | 需要新增"判断这条线程当前是否有活跃 run"的查询，且这个判断如果 `plan-control` 束也要用（见④），必须收敛成同一个事实源而不是各查各的——本次要新拉一条跨束依赖 |
| C | 不拦，且归档时顺带强制 cancel 活跃 run（复用 `plan-control` I-12 的 `cancel(action=interrupt)` 原语） | 保证"归档 ⇒ 完全静止"的同时不需要用户额外操作 | 归档这个动作会产生一个隐藏副作用（打断用户可能还想看完的回复），且直接触碰 `plan-control`（未签核）束的 run 取消语义，跨域改动，本轮明确排除在"只出契约文档"范围外 |

### ③ hover 动作组「删除」怎么共存

| 候选 | 怎么做 | 支持 | 代价 |
|---|---|---|---|
| A | 「删除」完全移除，菜单只保留 图钉/改名/归档，可逆归档是**唯一**清除线程的路径 | 用户不会再误触不可逆操作；符合"归档是主动作"的产品意图，菜单更简单 | 现有"硬删除需要审计 `reason`"这条能力从 UI 上完全消失（后端 `delete` op 仍在，但没有入口触发）——如果确有需要永久删除的场景（如合规要求彻底清除），需要另开路径 |
| B（推荐） | 主要动作变 图钉/改名/归档；「删除」降级——**未归档**线程的菜单不显示删除，**已归档**线程的菜单才出现「彻底删除」作为次要/危险区动作 | 保留硬删除能力但加一道"先归档"的天然确认门槛，防误删；符合任务描述里给的第二个建议方向 | 菜单在归档前后长得不一样（两态两份菜单结构），实现和测试面比 A 略大；用户想删一条线程要多点一步（先归档再删） |
| C | 归档与删除保持两个平级主动作，菜单变成 图钉/改名/归档/删除 四项，互不降级 | 改动最小，两条路径都不受影响 | 菜单从三项变四项，「删除」仍然一键可达不可逆操作，没有解决"归档想替代删除成为主动作"的产品意图；与任务描述给的方向不符 |

---

## 实现锚点（供后续实现 PR 参照，本轮不改）

- `packages/contracts/src/chat.ts`（`ThreadCard`、`mutateThread`）
- `apps/api/src/application/chat/mutate-thread.ts`（服务端 op 分支，具体路径按
  实现时的目录结构核实，本文件不越权断言未读过的实现细节）
- `apps/web/components/chat/thread-list-shell.tsx`（hover 动作组、四态状态机）
- `apps/web/components/chat/copilotkit-v2-shell.tsx:65-90,143-176`（头注需要在
  实现 PR 里同步更新，去掉"两处缺口待签核"的登记，改成指向本文件 + 签核后的
  `design-signoff.md`）
