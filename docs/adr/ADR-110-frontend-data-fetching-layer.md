# ADR-110: frontend-data-fetching-layer

- 状态: Proposed
- 适用层：项目实现（专属）
- 日期: 2026-09-03

## 背景

`apps/web` 当前**没有任何状态管理或数据获取库**（`package.json` 逐字核对：无 Redux/
Zustand/Jotai/Recoil/MobX，无 SWR/TanStack Query/Apollo）。技术栈是 Next.js 14 App
Router + React 18 + 纯手写 Context/hooks。实测现状（本次会话逐文件核实，非估算）：

1. **唯一的全局状态**是 `components/session/session-provider.tsx`（`SessionProvider`）。
   实现质量高：generation 计数器防止过期异步响应覆盖新状态、localStorage 两阶段提交
   （先写 payload、`SESSION_COMMIT_STORAGE_KEY` 最后写）+ 跨标签页 `storage` 事件同步、
   fail-closed 错误语义。代码里能看到 #596/#638 等真实 bug 修复留下的完整推理注释。
   这套自定义逻辑**没有理由推倒重来**——它解决的是"单一全局登录态"问题，Context
   本来就是对的工具。

2. **数据获取层**是 `lib/live-*.ts`，32 个按功能域分的文件（tasks/feedback/canvas/
   skill/projects/files/interviews/platform-members…）。逐文件核实：**其中 31 个是
   纯 typed API 封装函数**（如 `getMyToday`/`listTasks`，只是 `apiRequest<T>(...)`
   的薄包装，不含 state），**只有 1 个（`live-admin-nav-counts.ts`）是真正的 React
   hook**（`useLiveAdminNavCounts`，内含 `useState`+`useEffect`）。这层分工本身是
   合理的——"取数据"与"何时取/取几次/怎么应对竞态"被自然分开了。

3. **真正的缺口在消费端**：把这 32 个 API 封装接进组件状态，是**每个消费组件各自
   手写 `useState`+`useEffect`**（`components/` 365 个 `.tsx` 中 115 个直接用
   `useEffect`）。竞态保护——用户快速切换组织/翻页/换参数时，晚到的旧请求响应
   覆盖掉新状态——**全仓库只有 `useLiveAdminNavCounts` 一处做了**（用 `cancelled`
   标志位）。抽查另外 31 个 `live-*.ts` 的调用点，**无一使用 `cancelled`/
   `AbortController`/`ignore`/`stale`/generation 计数器等任何已知竞态防护写法**。
   这不是理论风险：`useLiveAdminNavCounts` 头注明确写着它是为了修一个**真实用户
   发现的 bug**（左栏计数与列表页计数对不上）而写的，说明同类问题在这个代码库
   里已经真实发生过，只是这次刚好修在了一个热点组件上，其余 100+ 处没有。

4. **无跨组件缓存/去重**：同一份数据被两个组件同时用到，会各自发起独立请求；
   页面间导航返回同一屏也会重新拉一遍，没有"先出缓存、后台悄悄刷新"（stale-
   while-revalidate）体验。

5. **Server Component 已经在用，但没做数据预取**：75 个 `page.tsx` 中 63 个未标
   `"use client"`（是 Server Component），但代码注释明确写着它们"只解析 URL、
   组装身份，把可序列化 props 交给客户端 App"——真实数据仍是客户端 `useEffect`
   打 NestJS API。所以现状是：进页面 → 出骨架屏 → JS hydrate → `useEffect` 跑 →
   请求打完 → 出数据，这段等待瀑布现在总是存在，不管页面本身多简单。

6. **手写的"保存后本地立即刷新"模式已经出现多次**：`SessionProvider` 的
   `updateDisplayName`/`updateOrgName`/`updateAvatarUrl` 都是"保存成功后不等
   下次拉取、本地立即 patch 状态"（避免保存成功的瞬间界面又闪一次 loading）。
   这正是数据获取库的"乐观更新/`setQueryData`"要解决的问题，目前每处都是手写。

## 决策

采用 **TanStack Query（React Query）v5** 作为客户端数据获取/缓存层，**不替换**现有
`lib/live-*.ts` 的 API 封装函数，**不改动** `SessionProvider`。

### 为什么是 TanStack Query 而不是 SWR 或继续手写

两者都能以几乎相同的接入成本包住现有的 32 个 API 封装函数（`useQuery({queryKey,
queryFn: () => listTasks(projectId)})` 对 `useSWR(['tasks', projectId], () =>
listTasks(projectId))`，改动量相当）。决定性差异：

- **这个应用是 mutation 密集型**（建任务、改任务状态、传附件、改资料、画布编辑、
  admin 操作……），TanStack Query 的 `useMutation`（含 `onMutate` 乐观更新 +
  `onError` 自动回滚 + 失败重试）比 SWR 的 `useSWRMutation`（附加包，功能更薄）
  更贴合现状——直接对应第 6 点里已经手写过好几遍的模式。
- **Devtools**：一个面板能看到全仓库任意时刻"谁在 fetch、缓存了什么、是否
  stale"，对一个已经证明"32 个域各自为政、约定不统一"的代码库，这是排查"为什么
  这屏数据没刷新"这类问题时最直接的省时工具，SWR 没有等价物。
- **RSC 预取/hydration 有原生支持**（`HydrationBoundary` + `dehydrate`），为后续
  （见"分阶段计划"第 4 阶段，Proposed 之外的可选项）把首屏数据挪进 Server
  Component 预留了现成路径，不需要届时再选型。
- **体积不是这里的真实约束**：`apps/web` 已经在跑 `fabric`（Canvas）、
  `monaco-editor`、`mermaid`、`pptx-preview` 这些量级的依赖，TanStack Query
  ~13kb（gzip，code-split 后更小）相对现状是舍入误差。

### 兼容性与最小改动的具体设计

- **新增**一个 `QueryClientProvider`，包在 `app/providers.tsx` 里 `SessionProvider`
  外层（`Providers` 组件本身多一层包装，零行为变化，见 Phase 0 的实际 diff）。
  **不改动** `SessionProvider` 内部实现。
- **不改**任何 `lib/live-*.ts` 文件——它们已经是纯函数、返回 `Promise<T>`，天然
  就是合格的 `queryFn`，一行都不用动。
- 迁移**按组件文件逐个进行**，每次迁移只改一个消费组件内部："`useState`+
  `useEffect`+ 手写 `cancelled`（有的话）" → "`useQuery`"，该组件对外的 props/
  行为契约不变，配套的既有测试文件（`.test.tsx`）原样保留，跑绿即为迁移正确
  的证据——不需要新写验收标准。
- 新增一个 `lib/query-keys.ts` 做 key 命名约定（前缀 = 功能域，如
  `["tasks", projectId]`），防止 32 个域各自发明一套 key 规则，重蹈
  `live-*.ts` 命名已经统一、但消费端约定从未统一的覆辙。

## 分阶段计划（每阶段可独立验收，可在任意阶段停下）

**Phase 0 — 基础设施 + 一个参照迁移（本 ADR 随附的最小可运行证明）**
- 加 `@tanstack/react-query` 依赖、`QueryClientProvider`、`lib/query-keys.ts`。
- 迁移**一个**真实文件作参照实现：选 `useLiveAdminNavCounts`（本来就是全仓库
  唯一已经手写竞态保护的 hook，迁移后应该"代码变少、保护不变或更强"，是验证
  这套方案成立的最佳单点）。
- 验收：既有测试（`admin-nav.tsx` 相关 `.test.tsx`）不改断言，跑绿。

**Phase 1 — 高风险域优先**（已证明缺竞态保护、且用户操作频繁触发"快速切换"场景）
- 组织切换相关的屏（跟 `SessionProvider.switchOrganization` 联动的所有列表/看板）、
  `tasks` 看板（`live-tasks.ts` 消费点）、admin 系列列表页。
- 逐文件迁移，每个 PR 一个组件文件，保持既有测试作为回归门。

**Phase 2 — mutation 迁移**
- 把"保存成功后手动 patch 本地状态"的既有模式（`updateDisplayName` 那一类，以及
  各 `create*`/`change*`/`update*` API 封装的消费点）换成 `useMutation` +
  `queryClient.setQueryData`，统一乐观更新/失败回滚写法。

**Phase 3 — 剩余 useEffect 调用点的机会性迁移**
- 不单独排期，"touch 一个文件就顺手迁移它" ——不需要为了迁移而迁移导致大范围
  无关 diff。

**Phase 4（可选，需另外裁决，不在本 ADR 授权范围内）**
- 把首屏关键数据（如 admin 总览、profile）的获取挪进 Server Component，用
  `HydrationBoundary` 把服务端预取结果直接 hydrate 给客户端，消除当前"骨架屏
  → 等 `useEffect`"的等待瀑布。这一步改动面更大（涉及 Server Component 与
  NestJS API 之间怎么转发鉴权），且当前 Server Component 刻意不做数据获取是
  有意为之的架构选择（见"背景"第 5 点原注释），需要单独评估，不随本 ADR 批准。

## 后果

**正面：**
- 消除"32 个域各自手写竞态保护、31 个没做"这个已证实的正确性缺口，且是**逐步
  收敛**而非一次性风险大改。
- 跨组件缓存/去重 + focus 时自动重新校验，直接改善"页面切换/返回时的数据新鲜度"
  体验，不需要额外产品设计。
- Devtools 降低"这屏数据为什么没更新"的排查成本，对一个已经证明约定不统一的
  代码库尤其有价值。
- 每一步迁移都可以用既有测试文件的绿灯作为正确性证据，不需要重新设计验收标准，
  符合本仓"没有证据=没有完成"的纪律。

**负面/成本：**
- 新增一个依赖（`@tanstack/react-query`，~13kb gzip），需要团队学习其 API（相对
  `useState`+`useEffect` 有一定学习曲线，但比自研缓存层小得多）。
- Phase 1-3 涉及 100+ 处调用点，是一个跨多个 sprint 的存量清理工作，需要按本仓
  "一个 issue 一个 PR"的纪律拆成许多小 PR，用 `ad-hoc-fix-pr-sop.md` 或正式
  sprint feature 流程都可以，视具体文件是否属于某个正在开发的 feature 而定。
- 迁移期间会短暂存在"部分组件用 `useQuery`、部分仍是手写 `useEffect`"的混合态，
  不是走完全部阶段才能受益——Phase 0/1 就已经开始止血,但代码风格暂时不统一，
  需要在过渡期内容忍。
