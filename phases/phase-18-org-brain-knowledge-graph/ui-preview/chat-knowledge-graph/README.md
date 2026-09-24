# chat-knowledge-graph · UI 先行原型（Phase 18）

ADR-023 签核**第 ① 件（UI）** 的材料。这些截图与组件落点最终由契约束的
`contracts/chat-knowledge-graph/ui.md` 引用。签核状态（`design-signoff.md` 的 `status`）
**只能由人类改**（硬规则 ①）——本文件只列「画了什么、做了哪些设计决定、待你核对什么」。

- **路由**：`/preview/chat-knowledge-graph?scene=<场景>&role=owner|member`
- **组件落点**（feature 开发时接真逻辑复用，不重写，ADR-003）：
  - 面板与子件：`apps/web/components/chat/knowledge/*`
  - mock 数据（纯前端，不接后端）：`apps/web/lib/mock/knowledge-graph.ts`
  - 预览页：`apps/web/app/preview/chat-knowledge-graph/page.tsx`
- **类型单源**：所有形状来自 `@repo/contracts/chat-knowledge-graph` 与 `@repo/contracts/context-pack`
  （`z.infer`，无手写第二份；三态文案/映射用 `KG_TRI_STATE_LABEL_ZH`/`claimTriState`）。
- **视角切换器**（`?role=`）是**预览手段不是权限实现**——真实权限在服务端 RLS，这里只做界面投影
  （uc-18-3 R5 所有者可编辑 / 其他成员只读两视角）。

## 截图 → UC/R 节对照

| PNG | 对应 UC / R 节 | 覆盖状态 |
|---|---|---|
| `uc-18-3-list-normal.png` | uc-18-3 R3-1 列表 · R8 | 正常（分组/三态徽标/证据数/头部入图状态/三态计数） |
| `uc-18-3-list-loading.png` | uiux 七态 · U1 | 加载（skeleton，`data-testid="loading"`） |
| `uc-18-3-list-empty.png` | uc-18-3 A1 · U2 | 空（引导文案 + 「整理本会话」，`data-testid="empty"`） |
| `uc-18-3-list-partial-failure.png` | uc-18-1 E1 · R8 | 部分失败（头部「失败 N 条 + 重试」+「整理中」） |
| `uc-18-3-list-error.png` | uc-18-3 · U3 | 错误（`KG_NOT_VISIBLE`，`role=alert` + 重试） |
| `uc-18-3-list-readonly.png` | uc-18-3 R5 / E2 | 只读（非所有者：无编辑菜单、无晋升入口、「只读」徽标） |
| `uc-18-3-graph-normal.png` | uc-18-3 R3-1 图 | 正常（@xyflow/react，实体/结论双列 + 三态配色 + 关系边） |
| `uc-18-3-graph-oversize.png` | uc-18-3 E4 · R3-1 | 超限（> `KG_GRAPH_VIEW_MAX_NODES`=200 折叠为簇 + 强制展开） |
| `uc-18-3-graph-loading.png` | uiux 七态 | 图·加载 |
| `uc-18-3-graph-error.png` | uc-18-3 | 图·错误 |
| `uc-18-3-edit-menu-owner.png` | uc-18-3 R3 / R4 | 所有者编辑菜单（确认/改写/标冲突 + 合并/拆分/改名 + 删除） |
| `uc-18-3-delete-confirm.png` | uc-18-3 R7-2 · 硬规则 ⑦ | 危险动作二次确认 + 影响范围说明（软失效、L1 副本失效、5 分钟 SLA） |
| `uc-18-3-readonly-no-edit.png` | uc-18-3 R5 / E2 | 只读视角无任何编辑按钮 |
| `uc-18-2-source-drawer-normal.png` | uc-18-2 · UC-KG-2 | 来源抽屉（证据摘录 + 跳到原消息/原文件 + provenance 溯源行） |
| `uc-18-5-source-drawer-revoked.png` | uc-18-5 R8 | 来源已删除（抽屉内提示「来源已删除，退出召回」） |
| `uc-18-2-answer-citations-why-recall.png` | uc-18-2 R8 · R3-5 | 回答引用 chip + 「为什么召回」展开（channels 图/向量/全文 + 图路径 + 相关度 + 未确认标） |
| `uc-18-2-answer-graph-unavailable.png` | uc-18-2 E1 · S6 | 「图检索不可用」可见提示（不静默降级） |
| `uc-18-2-answer-vector-unavailable.png` | uc-18-2 E2 | 「向量检索不可用」可见提示 |
| `uc-18-4-answer-from-personal.png` | uc-18-4 R3-6 · V1 | 新会话回答带「来自个人空间知识」标签（L1 召回） |
| `uc-18-4-promote-results.png` | uc-18-4 R3-5 / R4-E4 | 「存入个人空间」逐条结果（promoted / merged / needs_choice 合并\|并存 / rejected 带原因） |
| `uc-18-4-nomination-card.png` | uc-18-4 A1 · UC-KG-6 | AI 提名「值得记住」卡片（只提名，勾选后由人晋升） |

七态（空/加载/部分失败/错误/只读/正常/超限）在列表与图两视图都可逐态点选核对
（场景切换器在页面顶部）。

## 我替 UC 做的设计决定（人类请逐条核对）

这些是 R8 只给了一句线索、由原型补全的判断，是 sign-off 的重点：

1. **知识入口 = 会话右侧栏一个「知识」tab**（不是会话头部弹层）。沿用已有右侧栏
   `Tabs` 骨架（产物/材料两真标签的同一处），与既有设计语言一致（硬规则 ⑥）。
   R8 原文只说「会话头部**或**侧栏」——我选了侧栏，请确认。
2. **列表默认视图、图为切换**（右上 列表/图 图标切换）。R3 只说「两种视图可切换」，
   没定默认。理由：列表信息密度高、无需等 xyflow 加载，首屏更快。
3. **结论分组顺序**固定为 决定→事实→待办→风险→假设（`groupClaimsByKind`）。UC 未定顺序；
   按「决策相关性」排。
4. **三态配色**：待确认=warning（琥珀）、已确认=success（绿）、冲突=danger（红）。
   为此给 `components/ui/badge.tsx` **新增了一个 `success` tone**（token 对 `--success`/
   `--success-foreground` 已存在、已过对比度门）——请确认这个组件级扩展可接受。
5. **头部入图状态**合成为一行：「整理中（N 条）」+「失败 N 条 [重试]」+ 三态计数徽标。
   uc-18-1 R8 只说「带计数与整理中/失败 N 条状态」，具体布局是原型定的。
6. **「存入个人空间」= 头部进入多选模式**（勾选结论 → 提交），晋升结果回填在列表顶部。
   仅 `canPromote`（个人线程）时渲染入口（uc-18-4 E2）。
7. **删除影响范围文案**（软失效 / 反对证据保留 / L1 副本失效 / 5 分钟内影响召回）由原型撰写，
   综合自 uc-18-3 R7、uc-18-5 R7、S4——请核对措辞与事实是否一致。
8. **图视图只读**（`nodesDraggable/Connectable=false`）：编辑动作全部走列表视图的菜单。
   本轮图是「看清现状」，与 `agent-capability-graph-canvas.tsx` 同一取舍。
9. **实体节点与结论节点双列布局**、结论标题截断到 24 字。纯展示决定。

## R8 线索之间的矛盾 / 处理

- **uc-18-2 R3-5 vs context-pack 契约的 `retrievalReasons`**：需求把 retrievalReasons 描述成
  可读字符串（「图：张三 —decided→ 上线 v2」「向量 0.82」），而 `context-pack.ts` 的
  `ContextItem.retrievalReasons` 是 `FilterAction` **封闭枚举**、`channels` 是 `RetrievalChannel`
  枚举，**没有「图路径字符串」这个字段**。处理：原型的「为什么召回」用 channels（图/向量/全文）
  + `FilterAction` 展示名（线索/成对/召回，取自 `filter-action.ts` 单源）+ 相关度分渲染；
  **图路径那行是从 `KgEdge` + `KgObject`/`KgClaim` 的 mock 组合出的展示文本，不是新契约字段**。
- **uc-18-2 E1/E2「图/向量检索不可用」的数据来源在契约里缺位**：`omission-reason.ts` 的
  八类封闭枚举里**没有**「图/向量检索不可用」，`ContextPack` 也没有 per-channel 健康字段。
  处理：原型用 UI 侧的 `ChannelHealth`（本地 mock 结构）驱动那行提示，**没有发明契约**。见下「缺口」。

## 缺口（建议第 ③ 件签核时决策）

1. **「为什么召回」的图路径**：context-pack 当前无承载字段。要么在 `ContextItem` 增一个
   可选的可读 `graphPathHint`，要么约定前端从 KG 边组合（本原型的做法）。请拍板。
2. **「图/向量检索不可用」的权威来源**：需求要求「与 `omissions` 同源」（uc-18-2 R7-4），
   但 `omission-reason` 枚举无对应值、`ContextPack` 无 channel 健康位。建议扩 `omission-reason`
   或在 `RetrievalChannelPlan` 上加 `unavailable` 标志——属 context-pack 束改动，需一致性复核。

## 建议在束级 `design-signoff.md` 第 ① 件重点核对的 3 处

1. **知识入口落位**（右侧栏 tab）与**默认视图**（列表）是否符合产品心智——决定后端读模型与
   前端信息架构（设计决定 1、2）。
2. **三态配色 + Badge 新增 `success` tone**：是否接受这个组件级扩展；三态语义色是否要进
   `uiux-standards` 作为语义约定。
3. **上面两个契约缺口**（图路径字段、检索不可用来源）——这两处不定，UI 上「为什么召回」和
   「不可用提示」就没有权威数据源，会在联调时被就地发明（正是硬规则 ③ 要防的）。

## 自检

- `pnpm --filter web typecheck` ✅
- `pnpm --filter web vitest run tests/lib/knowledge-graph-mock.test.ts` ✅（2 passed）
- `node .harness/scripts/lint-contract-source.mjs` ✅（无手写第二份契约类型）
- `pnpm --filter web lint`（含 `lint-design.sh`）✅（token 无硬编码；七态；testid 前缀 `kg-`）
- dev server 起、每屏可点、xyflow 图渲染正常。控制台仅有 shell 层 `ERR_CONNECTION_REFUSED`
  （SessionProvider/QueryClient 在无后端的预览环境拉取鉴权失败，与其它 preview 页一致），
  非本原型组件的错误。
