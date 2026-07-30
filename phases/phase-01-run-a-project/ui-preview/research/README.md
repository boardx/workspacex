# research · 研究 Studio（M24）UI 先行原型 —— 截图索引

> 契约束 `research`（D-20 立项，约 21 点 / F144–F148）。**这是 phase-01 最后一块缺失的签核材料。**
> 路由：**顶层 `/research`**（不是 `/studio/research`——那条被 UC-0.2 Context Pack 占用，见「一、Q-2」）。
> 组件：`apps/web/components/research-studio/`（**不污染** 既有 `components/research/`，那是 Context Pack 的）。
> mock：`apps/web/lib/mock/research-studio.ts`（既有 `lib/mock/research.ts` 服务 Context Pack，与本域无关）。
> 视角/状态/屏/子态：`?as=` / `?state=` / `?screen=` / `?sub=`（仅开发可达，生产构建不渲染）。
>
> ⚠ 本 README 是**截图索引**，供 `contracts/research/ui.md` 引用。
> 截图目录已在 `.harness/scripts/ui-material-map.json` 声明为 `research → ui-preview/research`。
>
> 本文件引用 **49** 张截图，目录实际 **49** 张。

---

## 一、截图 → 屏 → UC / feature 映射

五份 UC 切成五块屏，各 7 态（default / loading / empty / invalid / dep-failed / denied / success）
= 35 张；+ 每屏 owner/collaborator 视角对照（owner = default，补 collaborator）5 张；
+ 9 张特殊子态（预览句另一取值 / 组预填 / 目标缺失 / 三种入库阻断 / 部分成功 / 只看冲突 / 冲突空态）。共 **49** 张。

| 屏 | screen 参数 | 依据 UC | feature | 截图前缀 |
|---|---|---|---|---|
| 研究 Studio 列表（+ 左栏三段） | `list` | UC-24.3 R3.A/C | F146 | `uc-24-3-list-<state>.png` |
| 研究计划详情（三计数 + 证据表） | `plan` | UC-24.3 R3.D | F146 | `uc-24-3-plan-<state>.png` |
| 新建深度研究弹层（七组字段 + 预览句） | `new` | UC-24.1 | F144 | `uc-24-1-new-<state>.png` |
| 研究主题详情（对话 + 四段 + 出口） | `detail` | UC-24.2 / 24.4 | F145 / F147 | `uc-24-2-detail-<state>.png` · `uc-24-4-detail-<sub>.png` |
| 现场深度研究与冲突判定 | `live` | UC-24.5 | F148 | `uc-24-5-live-<state>.png` |

⚠ feature 编号取自 `00-index.md` 的估点表（F144–F148）；`feature_list.json` 若已生成，以那里为权威。
本原型**不改** `feature_list.json`。

### 七态（每屏一张）

`default` `loading` `empty` `invalid` `dep-failed` `denied` `success`
— 每个前缀下 7 张：`uc-24-3-list-default.png` … `uc-24-5-live-success.png`。

各态在本域的落点（不是空壳套模板）：
- **empty**：列表「还没有研究」、计划「还没有证据」、详情「零来源→段④是数据需求说明不是结论（E2）」、
  现场「本场还没有研究任务」。**不出现编造示例**（A3）。
- **invalid**：新建=「问题必填、系统只做非空校验不做语义判定（E2）」；
  详情=「要补的来源类别不在来源偏好内 → SOURCE_PREF_VIOLATION，不静默越界（R7.1/A1）」；
  现场=「判定动作必须选一项，系统不替你预选（N-6）」。
- **dep-failed**：新建=`MODEL_UNAVAILABLE`「研究仍创建成功、停待运行」（E1）；
  详情=`AGENT_RUN_FAILED`「9 路已回、3 路失败可重试，已完成的先看」（E1，部分结果可见）。
- **denied**：**观察者只读投影**——出口=空集（N-10）。⚠ 见「四、我替人类做的判断①」为何观察者落在这一态。

### 视角对照（owner / collaborator，5 张）

`uc-24-3-list-view-collaborator.png` · `uc-24-3-plan-view-collaborator.png` ·
`uc-24-1-new-view-collaborator.png` · `uc-24-2-detail-view-collaborator.png` · `uc-24-5-live-view-collaborator.png`

owner = 各屏 `-default`。**collaborator 与 owner 真的不一样**（不是换个标签）：
- `detail`：`加入洞察库` / `标为关键问题` 变虚线 + 盾牌图标（点了会被服务端拒，不是灰按钮）；
  `本场转写` 来源行变「来自本场转写（原文脱敏）」+ 眼睛划掉图标（X-B）。
- `live`：冲突判定三动作**不渲染**，代之以「协作者无冲突判定动作（判定改变全场口径，[设计]，Q-14 未裁）」。

### 特殊子态（9 张，`?sub=`）

| 截图 | 子态 | 证明的不变量 |
|---|---|---|
| `uc-24-1-new-preview-alt.png` | 另一套七项配置 | 预览句是**算出来**的，不是写死（N-12 / N-4）|
| `uc-24-1-new-group-prefill.png` | 从第 2 组能力面进入 | 「组」被预填（A1）|
| `uc-24-3-plan-target-missing.png` | 证据目标缺失 | 渲染 `证据 41 / —` 而**不是** `/ 0`（N-8）|
| `uc-24-4-detail-block-no-source.png` | 入库阻断 | `NO_EXTERNAL_SOURCE`：点了被拒 + 说明（N-1）|
| `uc-24-4-detail-block-disputed.png` | 入库阻断 | `EVIDENCE_IS_DISPUTED`：争议项永不入库（N-2）|
| `uc-24-4-detail-block-conflict.png` | 入库阻断 | `CONFLICT_PENDING_HUMAN`：未判定冲突不入库（N-5）|
| `uc-24-4-detail-promote-partial.png` | 部分成功 | 入库成功 + 节点回流失败 `DECISION_NODE_GONE`，**不回滚已成功的入库**（E2）|
| `uc-24-5-live-conflict-filter.png` | 只看有冲突的 | 返回集 ⊆ {冲突数>0}（A1）|
| `uc-24-5-live-conflict-empty.png` | 冲突为 0 | 冲突区块**仍在**、显示空态，不消失（A2）|

### 不变量 → 在哪几张图看得出来（评审优先看这张表，对应 ui.md 第三节）

| 不变量 | 图 |
|---|---|
| N-1 入库需外部来源 | `uc-24-4-detail-block-no-source.png` |
| N-2 争议永不入库 | `uc-24-2-detail-default.png`（段②「此段永不进洞察库」）· `uc-24-4-detail-block-disputed.png` |
| N-3 低置信标出不丢弃 | `uc-24-2-detail-default.png`（段③ 0.3 + 低置信徽标）· `uc-24-3-plan-default.png`（证据表 0.3 行）|
| N-4 检索不越出来源偏好 | `uc-24-1-new-default.png` / `-preview-alt.png`（预览句「来源限定在…」）· `uc-24-2-detail-default.png`（执行步骤分类计数）|
| N-5 冲突先标不确定 | `uc-24-5-live-default.png` · `uc-24-4-detail-block-conflict.png` |
| N-6 建议不预选不自动执行 | `uc-24-5-live-default.png`（三动作平权 + 「建议 ≠ 默认执行」）|
| N-7 只归档不删除 | `uc-24-3-list-default.png`（行动作文案是「归档」）|
| N-8 缺失渲染 — 不是 0 | `uc-24-3-plan-target-missing.png` · `uc-24-2-detail-default.png`（段③末行置信度 —）|
| N-9 提出方留痕 | `uc-24-3-list-default.png`（「林可发起」）· `uc-24-5-live-default.png`（「第 n 组提出」）|
| N-10 观察者出口 = 空集 | 各屏 `-denied.png` |
| N-11 入库是候选洞察 | `uc-24-3-plan-default.png`（「待送综合 Studio 验证」）· `uc-24-4-detail-promote-partial.png` |
| N-12 七项配置是执行契约 | `uc-24-1-new-default.png` · `-preview-alt.png` |

---

## 二、界面上无法自洽的点（原型/UC/契约之间打架，我没糊，做成了可见分歧）

1. **🔴 Q-2 路由冲突（阻塞级，未裁）**：`/studio/research` 现在渲染 UC-0.2 Context Pack
   （`navigation.ts` 旧 ucRefs 逐字 `00-core/uc-0-2`），而本域的研究 Studio 是另一屏。
   **我的处置见「三」**。最终 IA 归并（Context Pack 迁进研究详情标签=方案 A，还是两个「研究」并列=方案 C）
   **仍待人类裁 Q-2**。
2. **Q-10 状态枚举**：四处列表出现至少八个词（`进行中`/`运行中`/`已完成`/`已出结论`/`待复核`/`待判定`/`已就绪`/`已归档`），
   无一处给全集，疑似同义对未证实。**mock 用原型逐字文案，不收敛枚举**（契约 `status` 是 `z.string()`）。
   图上你会看到 Studio 侧用「进行中/已完成/待复核」、现场侧用「运行中/已就绪/待判定」——**故意不统一**，等 Q-10。
3. **Q-12 「去向」枚举 + `反对证据` 归属**：证据表去向列只见 `已引用`/`反对证据`（我补了 `参考` 作为第三种展示值，
   **已在图下标注这是原型未给的展示占位**），全集未定；`反对证据` 与 phase-03 `14-brain` 决策链模板同名概念收敛未定。
4. **Q-7 来源类别简称/全称**：配置面板用全称五项，Scout 执行步骤与证据表用简称（官方/行业/媒体/判例检索），
   且两个全称（内部洞察库/本场转写）在简称侧无对应。**图上两套并存**，映射未定，不发明。
5. **Q-1 深度两串文案**：卡片用 `note`（「8 分钟·3 路·只要方向」），预览句用 `depthL`（「8 分钟·3 路检索」）。
   **两串都摆**（见 `uc-24-1-new-default.png` 选项卡 vs 底部预览句），不选权威。
6. **Q-17 现场第三列双语义**：无冲突显示「9 来源」、有冲突显示「冲突 2 处」——同一列两种语义，
   照原型排版摆着（`uc-24-5-live-default.png`），是排版取巧还是刻意设计未定。

---

## 三、`/studio/research` 路由冲突我怎么处置的

**最小可逆**的一步，不动已合入 `main` 的 Context Pack 代码：
- 研究 Studio 新建在**顶层 `/research`**（`app/research/page.tsx`），与 `/studio/research` 并存互不影响。
- `navigation.ts` 的「研究」一级导航 `href` 从 `/studio/research` 重指到 `/research`，
  `ucRefs` 从 `["00-core/uc-0-2"]` 换成 `24-research/uc-24-1…5`。理由：**原型的一级导航「研究」逐字指向
  研究 Studio**（`[原型 @16,157,163B]` 研究项目·3 / 研究问题、证据表、候选洞察），Context Pack 在原型里**不是**一级导航。
  重指与原型 IA 一致（COORDINATOR-LOOP 纪律第 7 条「原型是权威」）。
- `nav-reachability.config.json` 的 `bundleRoutes.research` 从 `/studio/research` 改为 `/research`，
  并把 `//5c`「绿得不诚实」注释更新为已解决 + 指回 Q-2。**`lint-nav-reachability` 那条绿从此是真的**
  （束路由渲染的就是束的屏）。
- Context Pack 页面**未改**，仍在 `/studio/research` 直达，只是不再挂在导航上——与「Context Pack 不是一级导航」一致。

⚠ 这**不等于**裁了 Q-2。Q-2 要人类定的是最终归并（方案 A 迁移 vs 方案 C 两个「研究」并列）。
我做的是不触碰已合入代码、可随裁决回退的一步。

---

## 四、我替人类做的判断（UC 没写明的，逐条请看）

1. **观察者落在 `denied` 态，不是第四个视角**。研究成员模型 = owner/collaborator 两档（U-1 已裁=B；
   原型研究管理区 16.099M–16.125M **无任何成员/角色控件**，负向印证）。但各 UC 的 R5 又用
   引导师/组长/组员/**观察者**四种项目角色描述可见性——**这是 U-1 与 UC-R5 的真实张力**。
   我的取舍：视角切换器只出 owner/collaborator（遵 U-1 的显式课程修正），
   把「观察者只读、出口=空集」投影到七态的 `denied`（N-10 仍被覆盖）。
   **请人类确认**：研究实体的成员是否就是 owner/collaborator，观察者是否只作为项目语境的只读投影。
2. **collaborator 的受限动作集** = {加入洞察库、标为关键问题}（`补充资料` 放行）。
   依据 UC-24.4 R5 的 `[设计]`「组员可补充资料；加入洞察库/标为关键问题是否需上级确认 → Q-14」。
   我按「受限」画（点了被拒 + 说明，不是灰按钮），**Q-14 裁定后需复核**。
3. **冲突判定动作只给 owner（=引导师）**，collaborator 无。依据 UC-24.5 R5「组长不可执行冲突判定——
   判定改变全场口径」的 `[设计]`。**Q-14 未裁前的画法**。
4. **证据表补了第三种去向 `参考`**（原型只给 `已引用`/`反对证据`）——因为 12 行放大数据里有既非引用也非反对的行。
   图下已标注这是展示占位，**不是**契约枚举（Q-12 未裁，契约 `disposition` 是 `z.string()`）。
5. **来源偏好全不选**：提交时**不拦**，由预览句显式提示「未选来源」（Q-5 三选一里我选了「不拦」的可见分歧，
   而非替它裁「拒绝创建」）。字段下方有一行文字说明这是未裁。
6. **`empty` 态的详情** = 「零来源→段④数据需求说明」，而不是通用空列表——把 E2 做成可见态。

---

## 五、明确没做的部分

- **Context Pack 的迁移/归并**（Q-2 方案 A）：未做，等人类裁。
- **状态/去向/来源简称三个枚举的收敛**（Q-10 / Q-12 / Q-7）：未做，mock 摆原型原值。
- **草稿态与研究模板层**（Q-4）：未做——原型 `×` 直接丢弃、无自动保存、无模板层，不发明。
- **`上台讨论` 的后果**（Q-18）：按钮在、点了**无后续屏**（原型只给按钮没给去向），不发明升级去向。
- **重复入库语义 / 已入库洞察随追问更新还是快照**（Q-15 / Q-6）：未表达。
- **研究项目/计划/主题的两层建模**（Q-8）：按「一层」画（一个研究 = 一个计划），
  「5 个研究问题」作为计数出现、不建独立 `Researchquestion` 实体（契约 `questionCount` 是 `nullable`）。
- **刷新率**（Q-20）：现场屏**不做**任何自动刷新计时器——原型的「每 15 秒」是知识图谱屏的，不是本域的。
- **feature_list.json / 契约 / 任何 *-signoff.md**：**未改**（硬约束）。

---

## 六、建议人类在束级 `design-signoff.md` 第 ① 件签核时重点核对的 3 处

1. **Q-2 的处置**（「三」）——`/research` 新路由 + 导航重指 是否可接受，还是要走方案 A 把 Context Pack 迁进来。
   这动到 `navigation.ts` 与 `nav-reachability.config.json` 两个已提交文件，是本次唯一触碰产品接线的地方。
2. **观察者 = `denied` 投影 而非第四视角**（「四①」）——U-1（owner/collaborator）与 UC-R5（四项目角色）的张力，
   我的取舍是否是你要的。若你要四视角对照，需回改视角切换器（会牵动权限投影画法）。
3. **collaborator 受限动作集 + 冲突判定仅 owner**（「四②③」，Q-14）——这两处是我按 `[设计]` 猜的边界，
   裁定 Q-14 后必须回来复核 `uc-24-2-detail-view-collaborator.png` 与 `uc-24-5-live-view-collaborator.png`。
