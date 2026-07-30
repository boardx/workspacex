# 契约束 `templates` — 签核① UI：人看到的界面对不对

> # ⚠ 截图待 ui-prototyper 产出后补 —— 在此之前第 ① 件**不具备签核条件**
>
> `phases/phase-01-run-a-project/ui-preview/` 下当前只有 **三份 markdown**
> （`README.md` / `PROTOTYPE-DIGEST.md` / `README-files.md`）与一个 `files/` 目录，
> **没有任何截图**。本文因此是**骨架**：它把「本束需要哪几块屏、哪些已建成、哪些没建」
> 写实，并给出约定的截图文件名，供 ui-prototyper 逐块补齐。
>
> **人类现在不应该在 `design-signoff.md` 的 ① 节打勾。** 没有截图的 UI 签核是签一张白纸。

---

## 一、本束需要哪几块屏

现状口径：**已建成** = `apps/web` 里有真实路由与组件、可跑起来；**未建** = 代码里不存在。
以下每一条都已在仓库里核实（`apps/web/app/projects/`、`apps/web/components/projects/`、
`apps/web/components/admin/`）。

> ⚠ **2026-07-30 本文写作期间发现 `apps/web/components/tpl/`（`tpl-app.tsx` / `parts.tsx`）
> 与 `apps/web/lib/mock/tpl.ts` 正在被并行产出，尚未提交、无路由挂载。**
> 已见 `tpl-nav` / `tpl-screen-switch` / `tpl-role-switch` / `tpl-confirm-impact` /
> `tpl-confirm-reason` 等 testid，形态像是本束原型的外壳与危险动作确认框。
> **本文下面的「未建」判定按本次核实时的已提交状态写实**；ui-prototyper 落地并截图后，
> 请逐块把「现状」列改成真实路由 + 组件路径 + 真实 `data-testid`，**不要凭这段注记直接改成「已建成」**。

### 1. 蓝本设计器（本束主屏）—— **未建**

| 项 | 内容 |
|---|---|
| 期望路由 | `/admin/blueprint/[blueprintId]`（后台 → 项目蓝本 → `[编辑设计 →]`）；⚠ 路由名待定 |
| 服务 feature | **F18 F19 F20 F21 F22**（外壳 / 档位与形式语言 / 模型与配额 / 六类一览与试跑 / 发布门槛） |
| 现状 | **未建**。`apps/web/app/admin/` 下只有 `[module]/page.tsx` 与 `page.tsx`；`AdminNav` 的模块集是 8 个（agent / skill / model / mcp / overview / members / feedback / local），**没有 blueprint** |
| 原型状态 | **整屏完整存在**（proto-05 深层抽取），D-05 判为「一级 · 可立即 sign-off」 |

必须原样呈现的元素（原型有具体文案，不是占位）：
- 版本条：`v4 已发布 · 用过 12 次 · 改动生成 v5，已开过的项目锁在自己的版本上`
- 自动保存：`草稿自动保存 · 14:52`（**不设保存按钮**）
- 动作条：`[预览参与者视图] [试跑一场] [发布 v5]`
- 侧栏分组标题：`基本配置 ✓` / `会前输入` / `现场` / `AI 能力` / `产出`
- 档位区：四档 + `[＋ 档位]` + 半场设计依据说明段
- 配额区：`单场预算 3.5M token，达 90% 自动降级…不硬停` + 「现场卡住比多花钱贵。」
- 贯穿全屏的规则句：「蓝本管骨架与默认值，不管具体内容。套用后引导师可逐场覆盖，改动只影响那一场。」
- 六类一览底部：「写入的是默认值。引导师在那一场里改，不会回写蓝本；要沉淀就在复盘里『提交回蓝本』。」

⚠ **侧栏标题不进「原样呈现」清单**：原型原文是「设计环节 16/16」，按 D-03 已正名为「设计配置」。
要求原样呈现一个被我们改过的字符串是自相矛盾的。**完成度 `n/分母` 的呈现形式保留，分母运行时读表**。

### 2. 后台「项目蓝本」列表页 —— **未建**

| 项 | 内容 |
|---|---|
| 期望路由 | `/admin/blueprint` |
| 服务 feature | **F30**（列表元数据 / 行操作 / 归档 / 删除 / 回滚 / 可见性），兼作 F22 新建三入口的入口 |
| 现状 | **未建**。需在 `ADMIN_NAV` 加第 9 个模块 |
| 原型状态 | **完整存在**（proto-03），可立即 sign-off |

行内容：名称 + `已发布 v4`/`草稿` + `N 环节·时长` + `用过 N 次` + `满意度 x.x` + `n/N 已配`
+ 行操作 `[编辑设计 →] [⧉ 复制] [× 删除 或 归档]`；页头 `项目蓝本（7 个 · 5 已发布 · 2 草稿）`；
页脚新建三入口。
⚠ `N 环节`（议程环节数）与 `n/N`（设计配置完成度）**是同一行里两个含义完全不同的数字，不得串位**。

### 3. 项目列表 —— **已建成**

| 项 | 内容 |
|---|---|
| 路由 | `/projects` |
| 组件 | `apps/web/app/projects/page.tsx` · `apps/web/components/projects/projects-screen.tsx` · `project-card.tsx` · `project-more-menu.tsx` |
| 服务 feature | F23（新建入口）· F30（项目行的蓝本版本显示） |

真实 `data-testid`（已在代码里核实）：
`projects-screen` · `projects-filters` · `projects-filter-<key>` · `projects-search` ·
**`projects-new`（⚠ 当前 `disabled`）** · `projects-filter-empty` · `projects-list` ·
`projects-historical` · `projects-historical-<id>` · `projects-card-<id>` ·
`projects-card-<id>-status` · `projects-card-<id>-enter` · `projects-card-<id>-design` ·
`projects-card-<id>-bigscreen` · `projects-card-<id>-output` · `projects-card-<id>-more` ·
`projects-more-<id>-archive` · `projects-archive-confirm-<id>` · `projects-archive-submit-<id>` ·
`projects-archive-cancel-<id>` · `projects-card-<id>-invite` · `projects-invite-panel-<id>` ·
`projects-invite-copy-<id>` · `projects-invite-revoke-<id>`

⚠ **两处已知缺口**：
1. `projects-new` 是**显式禁用**的，`title` 写着「新建项目要先选蓝本（UC-2.2），**蓝本设计器尚未建**」。
   这是诚实的处理（不做死按钮），但意味着 **F23 的整条主路径在界面上目前不可达**。
2. **蓝本版本 `蓝本 HMW 定题 v4` 只是 `MetaChips` 里的一段普通文本，没有独立 `data-testid`**
   （`project-card.tsx` 用 `c.startsWith("蓝本")` 做了字体加粗，仅此而已）。
   而 uc-2-4 V1、uc-2-1 V8、uc-2-2 V3 **三条验收都要断言它**。
   ⇒ **建议补 `projects-card-<id>-blueprint`**，否则只能靠文本匹配。

### 4. 项目枢纽页 —— **已建成（仅枢纽，子屏未建）**

| 项 | 内容 |
|---|---|
| 路由 | `/projects/[projectId]` |
| 组件 | `apps/web/app/projects/[projectId]/page.tsx` |
| 真实 testid | `project-home-title` · `project-home-role` · `project-home-surfaces` · `project-home-surface-<key>` |

它把项目内各工作面按「一场项目怎么跑」排好，并把**尚未建的屏渲染成显式禁用而不是死按钮**
（`href: null` + `pending` 说明）。**项目筹备就是其中一个未建的面**。

### 5. 项目筹备页（四子标签）—— **未建**

| 项 | 内容 |
|---|---|
| 期望路由 | `/projects/[projectId]/prep`（四子标签：定题与分组 / 议程 N 环节 / 材料准备 M 份 / 会前任务 x/y） |
| 服务 feature | **F24 F25** |
| 现状 | **未建**。`apps/web/app/projects/[projectId]/` 下只有 `page.tsx`、`canvas/`、`files/` |
| 原型状态 | `定题与分组` 子标签**完整存在**（定题区 + 分组区 + 组卡内观察/访谈对象表），可立即 sign-off；**另三个子标签打开后的编辑器尚未探明**——⚠ **未探明 ≠ 原型没做**，补抽取前不得自行设计其内部交互 |

### 6. 项目设置 → 工作流编排 —— **未建**

| 项 | 内容 |
|---|---|
| 期望路由 | `/projects/[projectId]/settings/workflow` |
| 服务 feature | **F26 F27** |
| 现状 | **未建** |
| 原型状态 | **整屏完整存在**（proto-08），可立即 sign-off |

含：模板行 `设计思维标准五步 · 已套用 · 来自后台 v2` + 议程环节链 +
`[去议程里细调] [另存为组织模板]`；矩阵表头 `环节 · 绑定 ｜ 引导师 ｜ 组长 ｜ 组员` +
「编排一次，三套视图与待办自动生成」+ 「每一格都会变成对应角色的一条待办，同步到「任务」里；
组长切换环节状态后，三种视角的首屏立刻跟着换。」+ `[看任务]`；模板库三行 `[改用这个]` + `[＋ 从空白搭]`。

⚠ 界面文案里的裸词「环节」照录原型原文；**我们自己的表述与字段名一律写全「议程环节」/ `agenda_stage`**。

### 7. 项目复盘 → 「提交回蓝本」 —— **未建，且原型未探明**

| 项 | 内容 |
|---|---|
| 期望路由 | 待定（复盘属哪个一级标签本身未定：成果沉淀？设置？独立屏？） |
| 服务 feature | **F29**（项目侧） |
| 现状 | **未建** |
| 原型状态 | ⚠ **未探明** —— 本轮抽取未点开复盘，**不能断言原型有没有画偏离清单**。requirement-author 已被要求**不得为此处编造 `data-testid`** |

### 8. 蓝本侧「待审改动」收件面 —— **未建，且原型确认缺失**

| 项 | 内容 |
|---|---|
| 期望路由 | 待定（列表行 / 设计器顶部 / 独立收件箱，三选一未定） |
| 服务 feature | **F29**（蓝本侧） |
| 现状 | **未建** |
| 原型状态 | ⚠ **已探明区域内确认缺失** —— 设计器整屏与蓝本列表页两处都**完整抽取过**，均无「待审改动」入口、计数角标或合并界面。**需补画** |

> ⚠ **第 7 与第 8 的性质不同，不可混为一谈**：一个是「还没去看」，一个是「看过了，没有」。
> 把它们当成一件事会导致要么白等补抽取、要么凭空发明界面。

### 9. 版本历史屏 / 回滚入口 / 删除确认 —— **未建，原型确认缺失**

服务 feature **F30**（uc-2-4 V6 V7 V7b 三条验收全落在这里）。已探明区域内确认缺失，**需补画**。

### 10. 可复用的既有组件（不是本束的屏，但本束依赖）

| 组件 | 位置 | 本束怎么用 |
|---|---|---|
| `StateShell`（七态） | `apps/web/components/state/state-shell.tsx` | D-36：七种必现状态 sign-off 时**豁免逐屏设计**，按 `uiux-standards` 统一实现。`/projects` 已用它演示了「蓝本服务不可用」依赖失败态与校验失败态文案 |
| `scope-badges` | `apps/web/components/admin/scope-badges.tsx` | F30 的可见性范围徽标（org-wide / team-only）可复用 |
| `?as=` 角色预览轴 | `apps/web/lib/identity.ts` | 四份 UC 的权限态验收（V14 / V10 / V8）用它切角色 |

---

## 二、截图清单（待补）

ui-prototyper 产出后请按下列文件名存入 `phases/phase-01-run-a-project/ui-preview/`，
并回到本文把每块屏的「现状」列从「未建」改为真实路由 + 组件路径 + 真实 `data-testid`。

| # | 截图文件名 | 内容 | 服务 feature |
|---|---|---|---|
| 1 | `ui-preview/tpl-blueprint-designer-shell.png` | 设计器外壳：版本条 + 自动保存 + 三动作 + 五组目录 + 完成度侧栏 | F18 |
| 2 | `ui-preview/tpl-blueprint-designer-tier.png` | 时长档位四档 + `[＋ 档位]` + 半场依据说明 + 换档位确认对话框 | F19 |
| 3 | `ui-preview/tpl-blueprint-designer-format-lang.png` | 形式三选 + 语言三选 + 「全线上自动 +2 环节」的来源标记 | F19 |
| 4 | `ui-preview/tpl-blueprint-designer-model-quota.png` | 模型策略三 lane + 配额区（含「现场卡住比多花钱贵。」） | F20 |
| 5 | `ui-preview/tpl-blueprint-designer-init-preview.png` | 右侧「套用后会初始化什么」六类一览 + 底部不回写提示句 | F21 |
| 6 | `ui-preview/tpl-blueprint-publish-gate.png` | 发布被拒两态：未试跑 / 必填未完成（含侧栏高亮与直达） | F22 |
| 7 | `ui-preview/tpl-blueprint-list.png` | 后台项目蓝本列表页：七行元数据 + 行操作 + 页头统计 + 新建三入口 | F30 |
| 8 | `ui-preview/tpl-blueprint-version-history.png` | 版本历史 + 回滚入口 + 回滚确认（**需补画**） | F30 |
| 9 | `ui-preview/tpl-blueprint-archive-delete.png` | 删除/归档确认与影响范围提示（「有 N 个项目仍引用此蓝本」）（**需补画**） | F30 |
| 10 | `ui-preview/tpl-new-project-wizard.png` | 新建项目向导两步：选蓝本 → 选档位 + 预览「将初始化什么」 | F23 |
| 11 | `ui-preview/tpl-project-prep-tabs.png` | 项目筹备页四子标签（标签名自带计数） | F24 |
| 12 | `ui-preview/tpl-project-prep-topic.png` | 定题区：主题/背景 + 三个 AI 按钮 + 来源计数 + `[保存并同步到全场]` | F24 |
| 13 | `ui-preview/tpl-project-prep-grouping.png` | 分组区 + 组卡 + 组状态三态 + 未分组人员 | F25 |
| 14 | `ui-preview/tpl-project-prep-subjects.png` | 组卡内观察/访谈对象表六列 + `[AI 建议人选]` | F25 |
| 15 | `ui-preview/tpl-workflow-orchestration.png` | 工作流编排整屏：模板行 + 环节链 + 三角色矩阵 + 模板库 | F26 |
| 16 | `ui-preview/tpl-matrix-to-tasks.png` | 矩阵格 → 待办的来源徽标与联动（跨到 `/tasks`） | F27 |
| 17 | `ui-preview/tpl-retro-submit-back.png` | 复盘 → 偏离清单 + 勾选 + 理由输入（⚠ **先补抽取原型**再画） | F29 |
| 18 | `ui-preview/tpl-pending-changes-inbox.png` | 蓝本侧待审改动收件面 + 同一处多场改动并排（⚠ **确认缺失，需补画**） | F29 |
| 19 | `ui-preview/tpl-project-card-blueprint-badge.png` | 项目卡上的 `蓝本 … v4`（补 `projects-card-<id>-blueprint` 之后） | F30 |

---

## 三、`ui-preview` 现有三份 markdown 里与本束相关的已知缺口

以下 S-xx 条目摘自 `ui-preview/README.md`（它们是「UC 没写、由实现者替 UC 做了的决定」，
**不是 bug，是缺口被填的位置**）。只摘与本束相关的：

| S-xx | 内容 | 与本束的关系 |
|---|---|---|
| **S-01** | 批准卡：机密数据能否与云端模型并存。原型同时印着「gpt-5.2 ＋ 本地 qwen3-32b」和「含机密，仅本地模型」，**字面矛盾**。实现取的口径是「机密只路由本地，云端可并存承接非机密部分」，`modelPolicyViolation()` 只在「有机密但无任何本地模型」时报违规 | ⚠ **直接决定本束 I-21 的断言形状**。若产品本意是「全程本地」，`setModelStrategy` 的校验与 `CONFIDENTIAL_ROUTE_VIOLATION` 的触发条件都要改。见 coverage 缺口 7 |
| **S-02 / S-03** | 角色本体是否需要「场景角色」这一层（合规负责人 / 研究员 / 受访者不在 `ProjectRole` 四值内，实现用 `?as=` `?view=` 临时投影，**这动摇了 O-03**） | ⚠ 本束 I-28「矩阵列集由角色表派生」依赖 O-03 恒 4 角色。**若 O-03 被推翻，矩阵的列集与三视角的定义都要重看** |
| **S-04** | 三个数值 UC 明写「需产品给出」，界面**拒绝编造**并用 `minSampleKnown/coefficientKnown/ledgerVersionKnown: false` 标死。其中 **② 最小样本量阈值** 正是本束 I-19 的那个阈值 | 本束 domain D-5 与它是**同一个未决数值**。⚠ 中途曾出现过 `sampleSize=18` 这类编造值制造「已算过」的假象，已删除——**本束不得重犯** |
| **S-13** | 后台里三条被补的东西：新造第 7 个 agent「Forge」、**18 台模型型号与定价全是编的**（`gpt-5.2`、`claude-opus-4.6`）、可选范围被降级为只读文字 | ⚠ 本束的模型策略三 lane 要从**已启用模型**里选（D-07）。那份模型清单当前**是编的**，本束不得把它当成事实源 |
| **S-14** | 危险动作都补了二次确认与影响范围（UC 只给了一个按钮）；项目 `归档` 已做三条影响范围 | 本束的**删除 / 归档 / 回滚 / 换工作流模板**四个危险动作应沿用同一套二次确认 + 影响范围模式，**不要各做一套** |
| **S-18**（部分） | ① **准备度阈值配色 ≥60/30–59/<30 是实现者自拟的**（UC 未定分档）② 四态项目卡走两套渲染 ③ **冲突条做成可显式触发的一态（`?conflict=on`），原型此条「确认缺失」** | ①对应本束 domain D-13（准备度口径）；③对应 uc-2-1 V17 / uc-2-2 V17 的并发态呈现 |

> `PROTOTYPE-DIGEST.md` 与本束相关的只有项目列表三行（`环节 3/7 · 12 人在场 · 4 组 · 蓝本 HMW 定题 v4` /
> `准备度 68% · 9/12 已确认 · 3 组 · 蓝本 商业模式共创 v3` / `准备度 15% · 未邀请 · 蓝本 假设风暴（快版）`）——
> 它们是 uc-2-4 V1 与 uc-2-2 V10 的原型依据，已建成于 `apps/web/lib/mock/projects.ts`。
> `README-files.md` 与本束无直接关系（只在一处提到「蓝本项目材料 9 件」作为计数钩子）。

---

## 四、七态豁免（D-36）

七种必现状态（默认 / 加载 / 空 / 校验失败 / 依赖失败 / 无权限 / 成功）**sign-off 时豁免逐屏设计**，
按 `.harness/instructions/uiux-standards.md` 的统一规范实现。
本束额外要求的**非豁免**状态（它们有具体业务语义，必须逐个确认）：

- **发布态三分**：草稿（未试跑）/ 草稿（已试跑可发布）/ 已发布 vN
- **蓝本行操作二分**：`[× 删除]`（引用数 = 0）vs `[归档]`（引用数 > 0）——**由服务端派生，不是前端隐藏**
- **降级可见态**：配额达 90% 时对话流里的降级提示（**不硬停**，会话继续）
- **待审改动三态**：pending / accepted / rejected，且提出人侧必须显示「已提交，等待 <维护者> 审阅」
- **同一处多场改动的并排态**：不自动择一、不按时间覆盖
