# chat-knowledge-graph · UI 先行原型（Phase 18）

ADR-023 签核**第 ① 件（UI）** 的材料。这些截图与组件落点最终由契约束的
`contracts/chat-knowledge-graph/ui.md` 引用。签核状态（`design-signoff.md` 的 `status`）
**只能由人类改**（硬规则 ①）——本文件只列「画了什么、做了哪些设计决定、待你核对什么」。

> 本轮改版目标（人类 2026-09-24「谁是用户、如何让体验到 9 分、容易使用、获得价值」）：
> 让原型**贴合 `requirements/06-user-experience.md`**——说人话、价值出现在对话里、打扰克制、一步改错。
> 用户是**一个人用 AI 工作**（P1 天天和 AI 聊工作的人 / P2 较真的专业用户），不是团队协作。

- **路由**：`/preview/chat-knowledge-graph?scene=<场景>&role=owner|member`
- **组件落点**（feature 开发时接真逻辑复用，不重写，ADR-003）：
  - 面板与子件：`apps/web/components/chat/knowledge/*`
    （新增：`answer-memory-line.tsx` U-1、`memory-card.tsx` U-4、`conflict-prompt-card.tsx` U-5、
    `memory-recall-answer.tsx` uc-18-6 C）
  - mock 数据（纯前端，不接后端）：`apps/web/lib/mock/knowledge-graph.ts`
  - 预览页：`apps/web/app/preview/chat-knowledge-graph/page.tsx`
    （`drawer-scene.tsx` / `panel-extras-scene.tsx` 是需要回调的两屏的 client 外壳）
  - 截图脚本：`apps/web/scripts/shot-chat-knowledge-graph.mjs`
- **类型单源**：所有形状来自 `@repo/contracts/chat-knowledge-graph` 与 `@repo/contracts/context-pack`
  （`z.infer`，无手写第二份）。三态文案 `KG_TRI_STATE_LABEL_ZH`、可见范围 `KG_VISIBILITY_LABEL_ZH`
  都取自契约单源，前端不另建映射表。
- **说人话（06 第五节用词表 / E6）**：界面标签**不含**「实体 / 结论 / 三态 / 晋升 / 本体 / L0 / L1」。
  面板标题是「记忆」；「记到我的长期记忆」= 晋升；「AI 记下的 / 你确认过 / 有矛盾」= 三态；
  「来自你 {日期} 的对话」= L1 召回；「忘掉这条」= 撤销。由单测 `knowledge-graph-mock.test.ts`
  的「E6 说人话」用例自动扫描所有展示标签，出现禁用词即红。
- **视角切换器**（`?role=`）是**预览手段不是权限实现**——真实权限在服务端 RLS，这里只做界面投影
  （uc-18-3 R5 所有者可编辑 / 会话成员只读两视角）。

## 截图 → UC / R 节 / 修订对照

价值出现在对话里（U-1 / U-4 / U-5 / uc-18-6，回答原位轻量展示，面板是可选的）：

| PNG | UC / R 节 · 修订 | 覆盖 |
|---|---|---|
| `uc-18-1-turn-captured.png` | uc-18-1 R8 · **U-1** | 回答下单行「已记下 N 条 · 查看 · 撤销」（安静的一轮，无主动卡片，E8） |
| `uc-18-1-turn-captured-expanded.png` | uc-18-1 · **U-1** | 「查看」展开逐条 |
| `uc-18-1-turn-pending.png` | uc-18-1 R8 · **U-1** | 「正在记…」（后台整理中，不阻塞正文，E10） |
| `uc-18-6-remember-card.png` | uc-18-6 A · **U-4** | 记住卡：可改字 + 「记住 / 不用」 |
| `uc-18-6-remember-card-done.png` | uc-18-6 A · **U-4** | 记住卡完成态「已记住 · 撤销」 |
| `uc-18-6-forget-card.png` | uc-18-6 B · **U-4** | 忘掉卡：逐条列出、默认全选、危险动作用 destructive |
| `uc-18-6-conflict-card.png` | uc-18-6 D · **U-5** | 矛盾卡「这和你 9/20 说的『…』不一致」+ 以新的为准 / 两条都留 / 忽略 |
| `uc-18-6-conflict-keep-both.png` | uc-18-6 D · **U-5** | 「两条都留」展开两个适用条件输入 |
| `uc-18-6-recall-answer.png` | uc-18-6 C | 「你记得关于 X 的什么」按「你确认过 / AI 记下的」分组 + 每条出处 + 「管理记忆」 |
| `uc-18-3-onetap-yesno.png` | uc-18-3 · **U-2** | 每条一键「对 / 不对」+ 头部「全部确认」 |
| `uc-18-3-onetap-wrong-open.png` | uc-18-3 · **U-2** | 「不对」就地展开「改写 / 忘掉这条」 |

记忆面板（uc-18-3，管理用；头部常驻可见范围 **U-6** `kg-visibility`）：

| PNG | UC / R 节 | 覆盖状态 |
|---|---|---|
| `uc-18-3-list-normal.png` | uc-18-3 R3-1 · R8 · **U-6** | 正常（分组/三态徽标/证据数/「仅你可见」/整理状态/一键对错/全部确认） |
| `uc-18-3-list-loading.png` | uiux 七态 | 加载（skeleton，`data-testid="loading"`） |
| `uc-18-3-list-empty.png` | uc-18-3 A1 | 空（零负担引导文案 +「整理本会话」，`data-testid="empty"`） |
| `uc-18-3-list-partial-failure.png` | uc-18-1 E1 · R8 | 部分失败（「失败 N 条 + 重试」+「整理中」） |
| `uc-18-3-list-error.png` | uc-18-3 | 错误（`KG_NOT_VISIBLE`，`role=alert` + 重试） |
| `uc-18-3-list-readonly.png` | uc-18-3 R5 · **U-6** | 只读（会话成员：无编辑、「只读」徽标、头部「会话成员可见」） |
| `uc-18-3-graph-normal.png` | uc-18-3 R3-1 图 | 关系图（@xyflow/react，人和事/记下的双列 + 三态配色 + 关系边，`<Handle>` 让边渲染） |
| `uc-18-3-graph-oversize.png` | uc-18-3 E4 | 超限（> `KG_GRAPH_VIEW_MAX_NODES`=200 折叠为簇 + 强制展开） |
| `uc-18-3-graph-loading.png` | uiux 七态 | 图·加载 |
| `uc-18-3-graph-error.png` | uc-18-3 | 图·错误 |
| `uc-18-3-edit-menu-owner.png` | uc-18-3 R3/R4 | `…` 完整菜单（确认/改写/标为有矛盾 + 合并/拆分/改名 + 忘掉这条） |
| `uc-18-3-delete-confirm.png` | uc-18-3 R7-2 · 硬规则 ⑦ | 「忘掉这条记忆？」二次确认 + 影响范围（退出召回、长期记忆副本失效、5 分钟 SLA） |

来源与召回（uc-18-2 / uc-18-4 / uc-18-5）：

| PNG | UC / R 节 · 修订 | 覆盖 |
|---|---|---|
| `uc-18-2-source-drawer-normal.png` | uc-18-2 · UC-KG-2 | 来源抽屉（证据摘录 + 跳原消息/原文件 + 溯源，溯源文案说人话） |
| `uc-18-5-source-drawer-revoked.png` | uc-18-5 R8 | 来源已删除（「这条不再被用到」） |
| `uc-18-2-answer-citations-why-recall.png` | uc-18-2 R8 · R3-5 | 回答引用 chip + 「为什么用到它」展开（关联/相似/全文 + 关系路径 + 相关度 + 「AI 记下的」标） |
| `uc-18-2-answer-graph-unavailable.png` | uc-18-2 E1 | 关联查询不可用：一行固定文案「这次没能查全你的记忆…」（不静默降级，带图标不只靠色） |
| `uc-18-2-answer-vector-unavailable.png` | uc-18-2 E2 | 相似查询不可用：同一行固定文案 |
| `uc-18-4-answer-from-personal.png` | uc-18-4 R3-6 · V1 · **U-6/M1** | 新会话回答带「来自你 9/20 的对话」标（跨会话召回） |
| `uc-18-4-promote-results.png` | uc-18-4 R3-5/E4 · **U-3** | 「记到长期记忆」逐条结果（含 AI 记下的一条也 promoted；拒绝只剩「有矛盾 / 来源已删」） |
| `uc-18-4-nomination-card.png` | uc-18-4 A1 · UC-KG-6 | AI 提名「值得记住」（只提名，人点了才记） |

七态（空/加载/部分失败/错误/只读/正常/超限）在列表与图两视图都可逐态点选核对。

## 我替 UC 做的设计决定（人类请逐条核对）

R8 只给一句线索、由原型补全的判断，是 sign-off 的重点：

1. **「记忆」入口 = 会话右侧栏一个 tab**（不是会话头部弹层）。R8 只说「头部或侧栏」——选侧栏。
2. **U-1 单行提示放在 AI 气泡内正文下方**，一行灰字 + 「查看/撤销」两个文字动作（不是按钮块），
   贯彻「打扰克制」（E8）。「正在记…」是同一行的 pending 变体。请确认这条位置与措辞。
3. **U-2 一键「对 / 不对」直接铺在每条记忆行下**（不是藏进 `…` 菜单）：「对」=确认，「不对」就地
   展开「改写 / 忘掉这条」。「你确认过」的行把「对」显示为已确认且禁用。头部「全部确认」只在
   有「AI 记下的」且可编辑时出现。这是「一步改错」（原则 4 / E5）的落点，请确认。
3. **U-3：「记到我的长期记忆」对 AI 记下的一条也可用**——逐条结果里 `clm-todo-migrate`（proposed）
   显示为 promoted；拒绝原因只剩「这条还有矛盾」「来源已删除」（已删除「需先确认」这一档）。
4. **U-4 卡片语气**：记住卡问「要记到你的长期记忆吗？」、忘掉卡「要忘掉这些吗？下面这些我就不再提了」。
   记住卡内容用 `Textarea` 可改字；忘掉是危险动作 → destructive 按钮 +「忘掉（N）」计数。措辞请核对。
5. **U-5 矛盾卡文案**：「这和你 {日期} 说的『…』不一致。现在你说的是『…』。」三个出口里，「两条都留」
   展开两个**适用条件**输入（对应契约 `resolveConflict.conditions.{newer,older}`）。日期在前端由
   `saidAt` 格式化成「9/20」。请核对这是否是你要的轻提示强度。
6. **U-6 可见范围徽标**常驻面板头部，`owner_only` 配 🔒「仅你可见」、`thread_members` 配 👁「会话成员可见」
   （带图标+文字，不只靠色，E6/E9）。只读视角（会话成员）自动显示后者。
7. **关系图节点副标题**改用「人物/公司/…」与「决定·你确认过」等类型词（**不写「实体/结论」**）。
   `<Handle>` 保留，边才画得出来。图仍只读（编辑走列表）。
8. **「为什么召回」→「为什么用到它」**；通道名改「关联/相似/全文」（不用「图/向量」）。查不全用
   一行固定文案（用词表指定），不逐通道罗列——对应 E10「只多一行说明」。
9. **忘掉/删除影响范围文案**（退出召回 / 反对证据保留 / 长期记忆副本失效 / 5 分钟）由原型撰写，
   综合 uc-18-3 R7、uc-18-5 R7、S4——请核对措辞与事实一致。

## R8 / 需求线索之间的矛盾与处理

- **uc-18-2 「为什么用到它」的关系路径字段在契约里缺位**：`context-pack.ContextItem` 的
  `retrievalReasons` 是 `FilterAction` 封闭枚举、`channels` 是 `RetrievalChannel` 枚举，**没有
  「关系路径字符串」字段**。处理：路径那行由 mock 从 `KgEdge`/`KgObject`/`KgClaim` 组合出展示文本，
  **没有发明契约**。见下「缺口 1」。
- **uc-18-2 E1/E2「查不全」的权威来源缺位**：`omission-reason` 八类枚举无对应值、`ContextPack`
  无 per-channel 健康字段。处理：原型用 UI 侧 `ChannelHealth`（本地 mock）驱动那行提示，文案是
  用词表第五节的固定句。见「缺口 2」。
- **06（U-1…U-6）与 uc-18-1…5 冲突时以 06 为准**（06 卷首明确）：本轮据此把「晋升/存入个人空间」
  统一改为「记到我的长期记忆」，把三态改成「AI 记下的 / 你确认过 / 有矛盾」，回改点已在上表标注。

## 对照 06-user-experience 的自查：E1–E10（各一句：原型怎么满足 / 哪些等实现）

- **E1 零负担**：原型不设任何必做设置；空态文案明说「你什么都不用做」；`turn-captured` 全程 0 点击就
  出现「已记下」。真正的「聊 3 轮后开新会话被记起」要 F02–F09 后端召回落地才能端到端验。
- **E2 记得住**：`recall-answer` 每条带出处；列表按类型分组、证据计数在。20 题回忆答对率≥90% 属
  评测集（F15）跑真实召回，原型不代替。
- **E3 答得对**：`answer-citations-why-recall` 展示关系路径（关联通道），体现 hybrid 优势；hybrid 比
  纯向量多答对≥20% 要真实检索评测。
- **E4 有出处**：引用 chip 可点、来源抽屉给摘录并可跳原消息/原文件；原话高亮要接真实消息渲染。
- **E5 改得快**：`onetap-*` 纠正 ≤ 2 次点击（对/不对→改写/忘掉）；对话里说「忘掉 X」= 忘掉卡。
  「下一轮不再提 X」要后端召回过滤，原型只呈现卡片与状态流转。
- **E6 看得懂**：全部展示标签不含禁用词（单测自动扫）；状态都带文字（三态徽标、可见范围、查不全提示
  都是「图标+字」不只靠色）。**这条在原型内即可判定，已满足。**
- **E7 会提醒**：`conflict-card` 在当轮回答下出现；「忽略」后本地不再显示。「同一冲突不再重复打扰」
  的持久化要后端 `resolveConflict=ignore` 落库。
- **E8 不打扰**：一轮最多一张主动卡片（页面层每个 turn 只渲染一个 prompt）；「已记下」是单行不遮正文。
  **原型内可判定，已满足。**
- **E9 放心**：可见范围常驻（`kg-visibility`）。「另一账号访问返回 403 + 界面『无权查看』」——错误态
  `list-error` 已画「你没有这条对话的访问权限」，但真正的 403 要服务端 RLS。
- **E10 不卡顿**：`turn-pending`「正在记…」表明整理在后台、不挡正文；查不全「只多一行说明」。首字延迟
  ≤100ms 是运行时指标，要真实链路测。

**一句话**：E6、E8 在原型内已可判定满足；E1/E2/E4/E5/E7/E9/E10 的**界面表达**都已就位，
其**端到端数值**要等 F02–F15 的后端与评测集。

## 缺口（建议第 ③ 件签核时决策）

1. **「为什么用到它」的关系路径**：context-pack 当前无承载字段。要么在 `ContextItem` 增一个可选
   可读 `graphPathHint`，要么约定前端从 KG 边组合（本原型做法）。请拍板。
2. **「查不全」的权威来源**：uc-18-2 要求与 `omissions` 同源，但枚举无对应值、`ContextPack` 无
   channel 健康位。建议扩 `omission-reason` 或在检索计划上加 `unavailable` 标志——属 context-pack
   束改动，需一致性复核。

## 待确认清单（签核状态由人类改，硬规则 ①）

- [ ] 用词表全面落地（记忆 / 记到长期记忆 / AI 记下的·你确认过·有矛盾 / 来自你 {日期} 的对话 / 忘掉这条）是否符合产品口吻。
- [ ] U-1 单行提示、U-2 一键对错、U-4/U-5 卡片的**位置与打扰强度**（是否够克制、是否遮正文）。
- [ ] U-5「两条都留」的两个适用条件是否要成为召回时的硬门（涉及契约语义）。
- [ ] 两个契约缺口（关系路径字段、查不全来源）的取舍——不定则联调时会被就地发明（硬规则 ③ 要防的）。

## 建议在束级 `design-signoff.md` 第 ① 件重点核对的 3 处

1. **U-1/U-2 的「价值在对话里、一步改错」落点**：回答下单行提示 + 每行一键对/不对，是本轮体验从
   「happy 演示」升到「9 分」的核心，决定后端读模型（`getTurnMemory` / `confirmClaims`）的形状。
2. **U-3「记到我的长期记忆对 AI 记下的也可用」**：逐条结果与拒绝码集合（只剩「有矛盾/来源已删」）
   与契约 `KgPromotionRejectCode` 一致——这关系到不变量 I-9，请确认界面表达没有走样。
3. **两个契约缺口**（关系路径字段、查不全来源）——UI 已用 mock 占位表达，权威字段未定。

## 自检

- `pnpm --filter web exec tsc --noEmit` ✅
- `pnpm --filter web lint`（含 `lint-design.sh`）✅（token 无硬编码；七态；testid 前缀 `kg-`；hover 带 transition）
- `pnpm --filter web exec vitest run tests/lib/knowledge-graph-mock.test.ts` ✅（6 passed，含 E6 禁用词扫描）
- `node .harness/scripts/lint-contract-source.mjs` ✅（无手写第二份契约类型）
- `pnpm -s exec tsx .harness/scripts/lint-ui-wiring.mjs` ✅
- `node .harness/scripts/lint-nav-reachability.mjs` ✅
- `pnpm -s run lint:contract-negative-assertion` ✅（未新增否定性断言散文）
- dev server 起、每屏可点、xyflow 图渲染正常（`<Handle>` 让边可见）。截图脚本报告 0 条应用层
  console error（仅 shell 层无后端鉴权拉取，与其它 preview 页一致）。
