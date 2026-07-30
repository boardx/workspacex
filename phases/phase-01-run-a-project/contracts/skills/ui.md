# 契约束 `skills` — 签核①：UI（界面落点）

> ## 自检（可机械核对）
>
> **本文件引用 67 张截图，目录下实际 67 张。N == M，无死链、无多列、无遗漏。**
>
> 目录：`phases/phase-01-run-a-project/ui-preview/skill-v2/`
> ⚠ **目录名是单数 `skill/`，与本契约束名 `skills` 不同**（束名复数、原型目录单数）。
> 上一版本文按 `ui-preview/skills-*.png` 约定了 14 个**设想文件名**，那 14 条**一张都不存在**——
> 全部是死链，已在第三节替换为真实索引。查图请一律走 `ui-preview/skill-v2/`。
> 目录下另有一份 `README.md`（ui-prototyper 自述：预览怎么走、它替 UC 做了哪些决定），
> 不计入截图数。
>
> ## 签核条件的现状（**替代旧的「不具备签核条件」断言**）
>
> 旧断言「ui-preview/ 下只有三份 markdown、没有任何截图」**已不成立**：
> ui-prototyper 已用 `apps/web` 真实组件（顶层并行路由 `/skill` + `components/skill/*`
> + `lib/mock/skill.ts`）产出 **6 屏 × 七态 + 关键交互/视角态，共 59 张**真实截图。
> **第 ① 件的材料已到位、可以开始逐屏评审。**
>
> 但**「材料到位」≠「已签」**，且仍有明确缺口（见第五节「第 ① 件材料缺口」，共 8 条）。
> 签核时须连同这 8 条缺口一并裁决（接受 / 要求补画 / 明确移出 phase-1）。
> **`design-signoff.md` 的 `status` 仍只能由人类改，agent 不许动。**

> 覆盖 feature 与依据 UC 见 `design-signoff.md`（权威）。本文所有路由、组件路径与
> `data-testid` **均已在仓库中核实**（`grep -rn "data-testid" apps/web/components/...`），不是推测。

---

## 一、本束需要哪几块屏

> ⚠ **读本节前必须先分清两个平面**（否则下面每条「已建成 / 未建」都会被误读）：
>
> | 平面 | 路由 | 代码 | 是什么 |
> |---|---|---|---|
> | **生产屏** | `/admin/skill`、`/admin/feedback`、`/chat`、`/projects/[id]/canvas` | `components/admin/*` · `components/chat/*` · `components/canvas/*` | 本仓**已有**的实现，接真实骨架；下面各屏的「已建成 / 未建」说的是**这一平面** |
> | **原型屏** | 顶层 `/skill`（`?screen=` 六屏 · `?as=` 六视角 · `?state=` 七态） | `app/skill/page.tsx` · `components/skill/*` · `lib/mock/skill.ts`（纯 mock） | ui-prototyper 为**签核第 ① 件**新建的并行路由，59 张截图全部取自这里 |
>
> 所以「屏 5 工作流编排**未建**」与「`uc-3-2-binding-*.png` 里有工作流编排」**同时为真**：
> 前者说生产平面没有 `/projects/[id]/settings`，后者说原型平面把它画出来了。
> ⚠ **这本身是签核要裁的第一件事**：`/skill`（mock）与 `/admin/skill`（已建成）
> 现在是**两套 skill 界面并存**，落地时必须收敛成一套，否则就是第二事实源。
> `lib/mock/skill.ts` 已申报进 `apps/api/tests/kernel/no-builtin-capability-lists.test.ts`
> 的 `DECLARED_MOCK_DEBT`，是被门控计数的债务，不是白拿的。

### 屏 1 · Skill 库（后台）— **已建成**

- **路由**：`/admin/skill`（`apps/web/app/admin/[module]/page.tsx` 派发）
- **组件**：`apps/web/components/admin/skill-screen.tsx`
- **服务的 feature**：F61（契约模型与四态）· F62（双重门禁、可见性、满意度）· F66（停用）
- **现状**：**已建成**（列表 + 契约三段 + 导入 + 新建 + 下线确认），但只有 happy path

真实 `data-testid`（核实于 `skill-screen.tsx`）：

| testid | 是什么 | 关联验收 |
|---|---|---|
| `admin-skill-list` | 列表容器 | uc-3-1 V10 空态 |
| `admin-skill-row-{id}` | 单条 skill 行（`sk-mece` / `sk-promote` / `sk-draft` / `sk-legacy` …） | uc-3-1 V1 |
| `admin-skill-status-{id}` | 四态徽标（enabled / review / draft / disabled） | uc-3-1 **V13** 四态断言 |
| `admin-skill-visibility-{id}` | 可见性徽标（全组织 / 仅某团队） | uc-3-1 V4 |
| `admin-skill-contract-{id}` | 契约三段（提示词模板 / 输入输出 schema / 数据范围声明） | uc-3-1 **V1**（AC1 的一半） |
| `admin-skill-add` / `admin-skill-panel` | 新建 skill 抽屉 | uc-3-1 R3 步骤1 |
| `admin-skill-field-name/duty/template/schema/scope` | 新建表单五个字段 | uc-3-1 R3 步骤1 |
| `admin-skill-import` / `admin-skill-import-dialog` / `-textarea` / `-submit` / `-cancel` | 导入契约 JSON | uc-3-1 触发条件① |
| `admin-skill-disable-{id}` / `admin-skill-disable-dialog` | 下线入口与二选一确认（立即中断 / 跑完当前一轮，复用 `DisableDialog`） | uc-3-4 **V1** |
| `admin-skill-toast` | 操作回执 | 七态成功态 |

⚠ **需要更正一处过期记载**：F66 的 notes 写「skill 的停用/归档入口为原型确认缺失」——
本仓**已经建成** `admin-skill-disable-{id}` 与共享的 `DisableDialog`。
真正缺的是**版本链、引用清单三栏、`[恢复]`、影响预览**（见下「未建清单」）。

⚠ **需要补画的（这块屏上本该有却没有）**：
`[试跑]` 入口与试跑结果 · `[批准发布]` / `[退回]` 审核动作 · 两道门禁结论并排显示 ·
`[查看内容]` 只读契约视图 · 版本链区块 · 引用清单三栏 · `[恢复]` · 「闲置」徽标 ·
来源标记的五取值徽标（当前 mock 只有 `手工` / `方法晋升` 二值）。

### 屏 2 · 反馈与迭代（后台）— **已建成**

- **路由**：`/admin/feedback` ｜ **组件**：`apps/web/components/admin/feedback-screen.tsx`
- **服务的 feature**：F68（聚合、归类分流、闭环指标）
- **现状**：**已建成**右栏聚合列表与闭环指标；**归类徽标、案例数第二口径、diff 页未建**

真实 `data-testid`：`admin-feedback-loop`（闭环指标）· `admin-feedback-board` / `-board-drawer` /
`-board-columns` / `-board-col-{key}` / `-board-card`（迭代看板抽屉）· `admin-feedback-export` ·
`admin-feedback-software` / `admin-feedback-sw-{id}` / `-sw-status-{id}`（软件反馈通道）·
`admin-feedback-agent` / `admin-feedback-agent-{id}`（Agent/Skill 改进反馈）·
`admin-feedback-triage-{id}` / `admin-feedback-triaged-{id}`（分诊）。

⚠ **已建界面与契约相反**：`admin-feedback-triage-{id}` 是「分诊并生成改进建议」**一个按钮打通到底**，
而 UC-3.6 AC4 要求**先归类**、`实现层缺陷` 类条目上**不出现**生成按钮。补画时必须拆成两步。

### 屏 3 · 对话输入区与 AI 消息 — **部分建成**

- **路由**：`/chat` ｜ **组件**：`chat/composer.tsx` · `chat/composer-settings.tsx` · `chat/ai-message.tsx`
- **服务的 feature**：F65（临时加减 skill）· F68（消息级评价采集）
- **现状**：**结果态已建**，**加减入口与评价控件均未建**

真实 `data-testid`：`chat-composer` · `chat-composer-status`（四段状态条，含 `skill：假设拆解`）·
`chat-composer-settings`（更多设置）· `chat-settings-panel` · `chat-settings-skill` /
`chat-settings-skill-{id}` · `chat-settings-agents` · `chat-settings-context` · `chat-settings-models` ·
`chat-ai-message` · `chat-ai-skill`（消息头 skill 角标）。

⚠ **两处必须在签核时裁决**：
1. `chat-settings-skill` 是一个**单选 chip 组**（`不用 skill` / 三选一），
   而 UC-3.3 要的是**多选的临时挂载列表**（`Ava ＋3`）＋ 加/减动作 —— **两者不是一回事**。
   改造它、还是并存？并存会立刻产生「两处都能改挂载」的第二事实源。
2. **消息上没有任何 👍/👎 控件**。UC-3.6 的整条链（满意度 → 聚合 → 提案 → 新版本）
   **数据源头缺失**；后台那句「来自消息级评价」是聚合结果，不能反推采集侧已画。

### 屏 4 · 画布左栏「本环节绑定的 skill」— **已建成**

- **路由**：`/projects/[projectId]/canvas` ｜ **组件**：`canvas/canvas-left-panel.tsx`
- **服务的 feature**：F64（运行时按环节挂载的只读投影）
- **现状**：**已建成，可直接签**（组员只读 + 触发入口，无增删改）

真实 `data-testid`：`canvas-left-panel` · `canvas-skill-{id}` · `canvas-skill-{id}-run`（`[运行]`）·
`canvas-skill-{id}-on`（`[已开]`）· `canvas-skill-{id}-ran`（运行回执）。

⚠ 缺的是「**因环节 03 载入**」的说明与**切环节自动更换**的联动（uc-3-2 V1/V4）。

### 屏 5 · 项目 → 设置 → 工作流编排 — **未建（本束最大的缺口）**

- **期望路由**：`/projects/[projectId]/settings`（`工作流编排` 子标签）
- **服务的 feature**：F63（绑定条目、模板套用、另存为组织模板）· F64（三角色矩阵 → 待办、孤立绑定处置）
- **现状**：**未建**。`/projects/[projectId]` 下只有 `canvas` 与 `files` 两个子路由，没有 settings。

⚠ UC-3.2 R8 写着「`设置 → 工作流编排` 屏**已存在**，可直接签」——
**那说的是 HTML 原型 `WorkspaceX Standalone.html`，不是本仓已建成的 React 屏**。
两者不可混为一谈。F63+F64 合计 8 点几乎全压在这块屏上。

需要的结构（依据 UC-3.2 R8 三块）：
① 工作流模板（`已套用 · 来自后台 v2` + 环节链 + `[去议程里细调]` `[另存为组织模板]`）；
② 环节编排矩阵（表头 `环节 · 绑定 ｜ 引导师 ｜ 组长 ｜ 组员` + `[看任务]`）；
③ 可切换的其它工作流模板（每行 `[改用这个]` + `[＋ 从空白搭]`）。

### 屏 6 · skill 详情页「来自组织大脑」区块 — **未建（新增设计）**

- **期望位置**：`/admin/skill` 行内展开或 `/admin/skill/[skillId]`
- **服务的 feature**：F67
- **现状**：**未建**。列表行只有一个「方法晋升」徽标（`sk-promote`）。
  需展示：源知识条目 · **那个被签字的决策** · 复盘结论 · 适用范围 · 有效期 · 复核负责人。
- ⚠ 触发端（14-brain 晋升队列）在 **phase-3**，phase-1 只做接收端 —— 这块区块的**数据会长期为空**，
  设计时必须给出真实空态（「尚无来自组织大脑的 skill」），**不得填样例**。

### 屏 7 · 会后复盘「偏离蓝本」清单 — **未建**

- **服务的 feature**：F65（AC1「临时加载被标出来并可提回蓝本」）
- **现状**：**未建**，且 UC-3.3 R10 明列「提交回蓝本的复盘流程归属与审批人」为待确认。

### 屏 8 · 改进提案 diff 页与人工复核界面 — **未建**

- **服务的 feature**：F68
- **现状**：**未建**。需左右 diff（左 `vN` 现行契约 / 右 `vN+1` 提案）＋ 顶部「AI 起草 / 人工已修改 N 处」
  ＋ 受影响引用清单 ＋ `[批准发布]` `[退回]`，另加 `待复核` / `已退回` / `待上线` 三态。

---

## 二、七态与本束特有状态

七种必现状态按 **D-36** 统一规范实现，签核时豁免逐屏设计（现有 `AdminScreen` 已支持
`?state=loading|empty|invalid|dep-failed|denied|success`，`skill-screen.tsx` 已逐条填了本束文案）。

本束**另加**的状态，必须逐一有界面：

| 状态 | 出处 | 现状 |
|---|---|---|
| `待审核` | uc-3-1 R8 | ✅ 已建（`admin-skill-status-{id}`，`sk-promote`） |
| `被退回` | uc-3-1 R8 | ❌ 未建 |
| `草稿` | uc-3-1 R8 | ✅ 已建（`sk-draft`） |
| `已停用`（含归档子类的呈现变体） | uc-3-4 R8 | ✅ 部分（`sk-legacy` 已停用），**`[恢复]` 出口未建** |
| `源方法已过期` | uc-3-5 R8 | ❌ 未建 |
| `待复核` / `已退回` / `待上线` | uc-3-6 R8 | ❌ 未建 |
| `样本不足`（满意度） | uc-3-6 AC3 | ❌ 未建（当前 `satisfaction === 0` 被**隐藏**，不是显示「样本不足」） |

---

## 三、截图索引（真实文件，59 张全列）

> 全部位于 **`phases/phase-01-run-a-project/ui-preview/skill-v2/`**——
> 再说一次：**目录名单数 `skill/`，束名复数 `skills`，两者不一致**，别去 `ui-preview/skills*` 找。
> 命名规律：`<uc>-<屏>-<状态或视角>.png`。抓图条件：`next dev`，视口 1360×900，2×，0 条真实控制台报错。
>
> 每屏固定 7 张七态（`default` / `loading` / `empty` / `invalid` / `dep-failed` / `denied` / `success`），
> 其余为该屏特有的**交互态**（`*-dialog`、`*-picker`、`*-viewer`、`*-diff`…）与**视角态**
> （`facilitator` / `member` / `observer` / `reviewer` / `editor`）。
>
> ⚠ **两种「拒绝」不可混用**：七态里的 `denied` = 服务端拒绝了这次请求（testid `denied`）；
> 视角态里的 `*-member-denied` / `*-role-denied` = 切到该预览视角时**界面本就不该出现**。渲染不同。

### 屏 A · `uc-3-1-library` — Skill 库与双门禁（12 张）｜UC-3.1 R3/R7/R8 · F61 F62

| 文件（`ui-preview/skill-v2/…`） | 类别 | 演示什么 |
|---|---|---|
| `uc-3-1-library-default.png` | 七态 default | Skill 库主屏：四态状态机、来源标记（系统按入口自动打标、提交人不可改写）、**待审核·双门禁**区（安全扫描 ✓通过 / ⚠有风险项 与 方法论审核 ⏳待审 / ↩已退回 两枚 Badge **并排**）、`[批准发布]` `[退回（附理由）]`、**自审自批禁用**（按钮 disabled + 红字「提交人 ≠ 审核人，O-21」）、`[试跑]`（挂 `补画` 黄标）、配额条 |
| `uc-3-1-library-loading.png` | 七态 loading | 库列表加载骨架 |
| `uc-3-1-library-empty.png` | 七态 empty | 库空态（uc-3-1 V10） |
| `uc-3-1-library-invalid.png` | 七态 invalid | 校验失败态：契约静态校验/越权（数据范围声明含无读权限的库） |
| `uc-3-1-library-dep-failed.png` | 七态 dep-failed | 依赖失败（安全扫描服务/模型不可用） |
| `uc-3-1-library-denied.png` | 七态 denied | **服务端**拒绝本次请求 |
| `uc-3-1-library-success.png` | 七态 success | 操作成功回执 |
| `uc-3-1-library-editor.png` | 交互态 | **新建 skill 三段契约编辑器**（提示词模板 + 输入输出 schema + 数据范围声明）。R8「真·未探明补抽取」 |
| `uc-3-1-library-contract-viewer.png` | 交互态 | `[查看内容]` **只读**契约三段并列视图 |
| `uc-3-1-library-tryrun-fail.png` | 交互态 · 特殊 | **试跑失败**：输出不符 schema → **不入库** + 失败原因 + 可复制日志。试跑入口属「原型确认缺失，补画」 |
| `uc-3-1-library-facilitator.png` | 视角 facilitator | 引导师只读浏览已启用 skill（uc-3-1 R5） |
| `uc-3-1-library-member-denied.png` | 视角 member | **组员看不到 skill 库**——视角投影级不可见，非请求被拒 |

### 屏 B · `uc-3-2-binding` — 绑定到环节与角色（12 张）｜UC-3.2 R3/R7/R8 · F63 F64

| 文件 | 类别 | 演示什么 |
|---|---|---|
| `uc-3-2-binding-default.png` | 七态 default | **工作流编排**主屏：①「设计思维标准五步 `已套用` `来自后台 v2`」+ 环节链 + `[去议程里细调]` `[另存为组织模板]`；② **议程环节 × 三角色矩阵**（表头 `议程环节·绑定｜引导师｜组长｜组员`，每格「待办·负责人=人」），**混合槽三类按色与前缀可区分**（`skill` / `画布模板` / `agent 产物`）、每条绑定记录 skill 版本（`MECE 假设拆解 v4`）、`[换绑 skill]`；右栏「两级继承：后台模板级默认 → 项目实例级可覆盖、不回写」 |
| `uc-3-2-binding-loading.png` | 七态 loading | 矩阵加载态 |
| `uc-3-2-binding-empty.png` | 七态 empty | 未套用任何工作流模板 |
| `uc-3-2-binding-invalid.png` | 七态 invalid | 绑定校验失败（如绑了不可见/未启用的 skill） |
| `uc-3-2-binding-dep-failed.png` | 七态 dep-failed | 依赖失败（模板服务/可绑定池取不到） |
| `uc-3-2-binding-denied.png` | 七态 denied | 服务端拒绝 |
| `uc-3-2-binding-success.png` | 七态 success | 编排保存成功 |
| `uc-3-2-binding-rebind.png` | 交互态 | **绑定槽编辑态 + 可绑定池**（池 = 已启用 ∩ 可见性覆盖）。R8 步 3「真·未探明补抽取」 |
| `uc-3-2-binding-saveas-dialog.png` | 对话框 | **`[另存为组织模板]` 确认**：须主持人确认、**不回写**后台模板本体（O-03）。这是「沉淀回组织」的**唯一显式路径** |
| `uc-3-2-binding-orphan-dialog.png` | 对话框 · 特殊 | **孤立绑定处置**：切模板/删环节时列出「哪些绑定与分工将被孤立」，**确认前不执行、不静默丢弃**（A1/A3 AC6） |
| `uc-3-2-binding-member.png` | 视角 member | **画布左栏只读投影**——组员侧「本环节绑定的 skill」，有触发入口、无增删改（F64） |
| `uc-3-2-binding-observer.png` | 视角 observer | 观察者可见环节结构、**不可见绑定清单** |

### 屏 C · `uc-3-3-temp` — 对话里临时加减（9 张）｜UC-3.3 R3/R8 · F65

| 文件 | 类别 | 演示什么 |
|---|---|---|
| `uc-3-3-temp-default.png` | 七态 default | 输入区上方**运行时配置带**：`Ava ＋3` + 已挂载 skill chip（`假设拆解 v4` / `语音转便签 v3` / `旅程图生成 v2 · 临时 ×`）、`[＋ 加技能]`（挂 `补画 · 入口原型确认缺失` 标）、「摘掉即时生效但历史消息角标保留（不回溯）」说明；下方**「会后复盘 · 临时挂载」**区块 + `[提交回蓝本]`（AC1） |
| `uc-3-3-temp-loading.png` | 七态 loading | 配置带加载 |
| `uc-3-3-temp-empty.png` | 七态 empty | 本条对话无任何临时挂载 |
| `uc-3-3-temp-invalid.png` | 七态 invalid | 挂载校验失败 |
| `uc-3-3-temp-dep-failed.png` | 七态 dep-failed | 依赖失败 |
| `uc-3-3-temp-denied.png` | 七态 denied | 服务端拒绝（组员直连接口） |
| `uc-3-3-temp-success.png` | 七态 success | 挂载/摘除成功 |
| `uc-3-3-temp-picker.png` | 交互态 | **`＋加技能` 选择器，分两段**：本环节**已绑定**（只读）/ **可临时加载**。R8「原型确认缺失，补画」 |
| `uc-3-3-temp-member.png` | 视角 member | 组员**看不到** `＋加技能`，且直连接口被服务端拒（E1）——界面不可见与服务端拒绝是**两道**，缺一不可 |

### 屏 D · `uc-3-4-versioning` — 版本与停用（10 张）｜UC-3.4 R3/R8 · F66

| 文件 | 类别 | 演示什么 |
|---|---|---|
| `uc-3-4-versioning-default.png` | 七态 default | **版本链时间线**（v5 草稿 / v4 生效 / v3 已归档 / v2 已归档，每节点带双门禁结论与「被 N 处引用锁定」）、**升级提示不阻断**（「有新版本 v5 可用——默认不自动跟随，由引导师显式升级」+ `[升级到 v5]`）、**危险动作区**分离（`[停用]` `[恢复（已停用的 skill 重新进入可绑定池）]` `[硬删除]`，挂 `补画 · 停用/恢复入口原型确认缺失` 标）+「停用 ≠ 删除，删除走 17-gov / UC-17.2」 |
| `uc-3-4-versioning-loading.png` | 七态 loading | 版本链加载 |
| `uc-3-4-versioning-empty.png` | 七态 empty | 尚无历史版本 |
| `uc-3-4-versioning-invalid.png` | 七态 invalid | 版本操作校验失败 |
| `uc-3-4-versioning-dep-failed.png` | 七态 dep-failed | 依赖失败 |
| `uc-3-4-versioning-denied.png` | 七态 denied | 服务端拒绝 |
| `uc-3-4-versioning-success.png` | 七态 success | 版本操作成功 |
| `uc-3-4-versioning-disable-dialog.png` | 对话框 | **停用确认**：**引用清单三栏嵌进对话框**（进行中项目 / 蓝本绑定 / agent 挂载）+ 影响预览 |
| `uc-3-4-versioning-harddelete-dialog.png` | 对话框 · 特殊 | **硬删永久拒绝**：返回引用清单 + 说明内置不可删（R3） |
| `uc-3-4-versioning-reviewer.png` | 视角 reviewer | 方法论审核人视角下的版本链与可执行动作 |

### 屏 E · `uc-3-5-promotion` — 方法晋升生成 skill（8 张）｜UC-3.5 R3/R8 · F67（**接收端**）

| 文件 | 类别 | 演示什么 |
|---|---|---|
| `uc-3-5-promotion-default.png` | 七态 default | 顶部**边界待裁决横幅**（触发端 14-brain 在 phase-3 / D-24，本 phase 只做接收端）；「组织大脑 · 晋升队列」标为 **`触发端示意 · 非本 phase 交付`**；生成回执「已生成 skill《…》`待方法论审核`」+ 红字「绕过门禁直接置为已启用会被服务端拒绝并记审计——**自动生成 ≠ 自动发布**」；**「来自组织大脑」区块**（挂 `补画 · 新增设计` 标）含源知识条目 · **那个被签字的决策 #D-1487** · 复盘结论 · 适用范围/有效期 · 复核负责人 |
| `uc-3-5-promotion-loading.png` | 七态 loading | 队列/区块加载 |
| `uc-3-5-promotion-empty.png` | 七态 empty | ⚠ **本束最该被人看的一张**：触发端在 phase-3，这块区块**会长期为空**，此图是那个真实空态（不得填样例） |
| `uc-3-5-promotion-invalid.png` | 七态 invalid | 晋升校验失败 |
| `uc-3-5-promotion-dep-failed.png` | 七态 dep-failed | 依赖失败（触发端未就位） |
| `uc-3-5-promotion-denied.png` | 七态 denied | 服务端拒绝 |
| `uc-3-5-promotion-success.png` | 七态 success | 晋升生成成功回执 |
| `uc-3-5-promotion-approve-dialog.png` | 对话框 | **`[批准并推给全员]` 确认面板** + skill 草稿预览 + 「同时生成 skill」勾选。R8「真·未探明补抽取」 |

### 屏 F · `uc-3-6-feedback` — 改进反馈与版本触发（8 张）｜UC-3.6 R3/R8 · F68

| 文件 | 类别 | 演示什么 |
|---|---|---|
| `uc-3-6-feedback-default.png` | 七态 default | **采集侧**（挂 `补画 · 👍/👎 评价控件原型确认缺失` 标）：AI 消息下 `[👍 有用]` `[👎 待改进（可填理由）]` + **完整归因链**「消息 → agent(Facilitator) → skill(提议收敛) → skill 版本(v4)」+「127 条评价无法归因到具体 skill 版本——只计入 agent 级、不计入任何 skill 满意度，已列入数据质量报表」；**聚合队列**每项带**归类徽标**（`契约可解` / `实现层` / `模型所限`）+ **👎 数与原始案例数两个口径**（`计数 9 · 原始案例 12（分口径）`）+ `[看 N 个原始案例]`；**归类决定按钮可见性**——`契约可解` → `[生成 skill 改进 PR]`，`实现层`/`模型所限` → 只给 `[软件反馈通道]`（兑现 O-35：结构性判据，不用相似度打分）；「反馈量低于最小样本量，满意度显示『样本不足』」 |
| `uc-3-6-feedback-loading.png` | 七态 loading | 聚合队列加载 |
| `uc-3-6-feedback-empty.png` | 七态 empty | 无聚合项 |
| `uc-3-6-feedback-invalid.png` | 七态 invalid | 校验失败 |
| `uc-3-6-feedback-dep-failed.png` | 七态 dep-failed | 依赖失败 |
| `uc-3-6-feedback-denied.png` | 七态 denied | 服务端拒绝 |
| `uc-3-6-feedback-success.png` | 七态 success | 提案/复核成功回执 |
| `uc-3-6-feedback-diff.png` | 交互态 · 特殊 | **契约改进提案左右 diff**（`v4 → v5`，逐行增删高亮：触发条件 3 次 → 5 次）+ 顶部留痕 `AI 起草` / `人工已修改 2 处` + **受影响引用清单**（进行中项目 3 · 蓝本绑定 5 · agent 挂载 1，「升级后按锁定版本，不自动跟随」）+ 「**未经人工复核不得上线**：绕过被拒并记审计，提交人 ≠ 复核人」+ `[批准发布（触发发新版）]` `[退回]`。**改进 PR = 契约变更提案，不是代码 PR（D-06）** |

**合计：12 + 12 + 9 + 10 + 8 + 8 = 59 张。与目录实存数一致。**

---

## 四、第 ① 件材料缺口（8 条，签核时须逐条裁决）

> 上一版本文列的 14 个设想文件名里，**13 个在真实截图中都能找到对应**（见上表映射），
> 只有「独立的待审核队列屏」被合并进了 `uc-3-1-library-default` 的「待审核 · 双门禁」区，
> 未单独成屏——**这属于设计取舍，不是缺口**。
> 下面 8 条才是**真正没画出来的东西**。**它们没有截图可以指向，请勿在签核时当作已看过。**

1. **⚠ 未产出：试跑的成功态 —— 该屏尚未画。**
   只有 `uc-3-1-library-tryrun-fail.png`（schema 不符 → 不入库 + 可复制日志）。
   「试跑通过后长什么样、结果如何呈现、是否可作为门禁证据」无图。F62 的试跑一半没有材料。

2. **⚠ 未产出：`源方法已过期` 状态（uc-3-5 R8）—— 该状态尚未画。**
   `uc-3-5-promotion-default.png` 只在队列统计里出现「同期 11 条降级或过期」这个**计数**，
   skill 侧「源知识被推翻/撤销 → 对应 skill 自动转已停用且不硬删」的**状态呈现无图**。

3. **⚠ 未产出：改进提案的 `待复核` / `已退回` / `待上线` 三态徽标（uc-3-6 R8）—— 尚未画。**
   `uc-3-6-feedback-diff.png` 画了 `[批准发布]` `[退回]` 两个**动作**，
   但提案本身的三态**流转徽标**没有出现。动作 ≠ 状态机。

4. **⚠ 未产出：「闲置」徽标 —— 尚未画。**
   原文第一节「屏 1 需补画」清单里列了它，59 张里无对应呈现。

5. **⚠ 未产出：五取值来源徽标同屏并陈 —— 尚未画齐。**
   截图中可见的来源取值只有 `社区` / `自建` / `晋升生成` 三种（分散在 library 与 promotion 两屏），
   五取值**在同一屏并列对照**的图不存在，无法核对色彩/文案是否互斥可辨。
   （`社区导入` 入口按 D-06 置灰，属已确认设计，不算缺口。）

6. **⚠ 未产出：工作流编排的第 ③ 块「可切换的其它工作流模板」+ `[＋ 从空白搭]` —— 截图可见范围内未出现。**
   `uc-3-2-binding-default.png` 兑现了 UC-3.2 R8 三块中的 ①（模板套用）与 ②（三角色矩阵），
   第 ③ 块在 1360×900 视口的可见区内没有；它**可能**在页面折叠下方但未被抓图。
   **无图可指 = 视同未产出**，请要求补一张滚到底的图，或明确该块移出 phase-1。

7. **⚠ 未产出：响应式档位 —— 仅抓了 1360 桌面档。**
   `AppShell` 有 375 / 768 / 1280 三个断点，本次一档未抓（ui-prototyper README 第五节自述）。
   矩阵屏（`uc-3-2-binding`）是四列表格，窄档如何降级**完全没有材料**。

8. **⚠ 未产出：四块「生产屏」本身一张截图都没有 —— 只有并行原型屏 `/skill` 的图。**
   59 张全部出自 mock 路由 `/skill`。本仓**已建成**的 `/admin/skill`、`/admin/feedback`、
   `/chat`、`/projects/[id]/canvas` 四块生产屏，**没有任何截图进入本次材料**。
   于是第二节点出的「**已建界面与契约相反**」两处（`chat-settings-skill` 单选 chip vs 多选挂载；
   `admin-feedback-triage-{id}` 归类与生成合成一个按钮）**在原型里被绕过、而不是被修**——
   原型画的是"应该长什么样"，生产屏仍是"现在错着的样子"。
   ⚠ **这是本束最大的签核风险**：两套 skill 界面并存，落地时若两边各活各的，
   就是 ADR-020 要防的第二事实源。**收敛路径必须在签核时定死**（改造生产屏 / 原型屏转正 / 二选一）。

---

## 五、ui-preview 顶层 markdown 里与本束相关的已知缺口

> 这些是 `ui-preview/README.md`（**顶层那份**，不是 `ui-preview/skill-v2/README.md`）记录的
> 「UC 没写、由实现者替 UC 做了的决定」。与本束相关的有四条，签核时请一并确认。

| S 编号 | 内容 | 为什么与本束相关 |
|---|---|---|
| **S-04** | 三个数值 UC 明写「需产品给出」，界面**拒绝编造**并用 `minSampleKnown: false` 标死。⚠ 中途曾出现过编造的 `sampleSize=18`、「口径表 v3」，制造「已算过、已过线」的假象，已删除 | 本束的**最小样本量 10 / 聚合浮现阈值 3** 是同一类东西（O-37 给了建议值但明写需产品确认）。⚠ **必须走 `packages/contracts/src/thresholds.ts` 的待定阈值登记表**，不得在 mock 或界面里写死 |
| **S-13** | 后台里三条被补的东西：新造第 7 个 agent「Forge」、18 台模型型号与定价全是编的、「可选范围」被降级为只读文字 | 本束的 skill 依赖模型选择（「只能选测试通过并已启用的模型」）建在这批编造数据上；`sk-promote` 的「MCP:欧盟法规库（待评审）」同理 |
| **S-02 / S-03** | 合规负责人不在角色模型里；访谈/问卷的场景角色不在 `ProjectRole` 四值内。实现用 `?as=` / `?view=` 两根预览轴绕过 | 本束需要的**能力维护者 / 方法论审核人 / 安全评审人 / 复核负责人 / 协同引导师**同样不在四值里。这是 S-02/S-03 的**第三、四个面**，建议合并裁决（见 `coverage.md` 缺口 12） |
| **S-14** | 危险动作都补了二次确认与影响范围（UC 只给了一个按钮） | 本束的**停用**沿用了这条（`DisableDialog` 的立即中断 / 跑完当前一轮）。⚠ 该二选一语义**复用自 T03**，是共享实现——本束不得再写第二份 |

`PROTOTYPE-DIGEST.md` 中与本束相关的三处（均为已建成投影，可作为截图取景依据）：
AI 发言头部 `skill: MECE 假设拆解` · 画布左栏「本环节绑定的 skill」（`提取假设 → 假设树 [运行]` /
`语音转便签 [已开]`）· 后台七模块导航（总览 / Agent / **Skill** / 模型 / MCP / 成员配额 / 反馈）。


---

## 附录 · v2 新增截图索引（3.1 试跑整屏补画（场景×执行轨迹×自动校验×回归用例））

> 门控 `lint-ui-material` 做双向集合相等：本束目录 `ui-preview/skill-v2/` 实存 **67** 张，上文各屏引用的既有 59 张 + 下面新增 **8** 张 = **67**，逐张列出、无孤图、无死链。

> 既有屏（权限/路由/MCP/团队/审计 或 库/绑定/版本/晋升/反馈 或 现场/指派/引述/保留）的截图**已随本目录复制进 v2**，其文件名与引用见上文各节，未改动；此处只补列本轮**新画/重拍**的屏。

- `uc-3-1-tryrun-default.png`
- `uc-3-1-tryrun-denied.png`
- `uc-3-1-tryrun-dep-failed.png`
- `uc-3-1-tryrun-empty.png`
- `uc-3-1-tryrun-invalid.png`
- `uc-3-1-tryrun-loading.png`
- `uc-3-1-tryrun-role-denied.png`
- `uc-3-1-tryrun-success.png`
