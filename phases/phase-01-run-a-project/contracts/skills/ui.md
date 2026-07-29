# 契约束 `skills` — 签核①：UI（界面落点）

> ## ⚠ 现在这一件**不具备签核条件**
>
> `phases/phase-01-run-a-project/ui-preview/` 下**只有三份 markdown，没有任何截图**
> （`README.md` / `PROTOTYPE-DIGEST.md` / `README-files.md`）。
> 本文因此是**骨架**：它写清「本束需要哪几块屏、哪些已建成、真实 testid 是什么、
> 截图该叫什么名字」，但**第 ① 件要等 ui-prototyper 产出截图后才能被人类确认**。
> 在此之前请不要把 `design-signoff.md` 的 `status` 改成 `confirmed`。

> 覆盖 feature 与依据 UC 见 `design-signoff.md`（权威）。本文所有路由、组件路径与
> `data-testid` **均已在仓库中核实**（`grep -rn "data-testid" apps/web/components/...`），不是推测。

---

## 一、本束需要哪几块屏

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

## 三、截图清单（待补）

ui-prototyper 产出后请按这些文件名放进 `phases/phase-01-run-a-project/ui-preview/`：

| 文件名 | 内容 | 现状 |
|---|---|---|
| `ui-preview/skills-library.png` | `/admin/skill` 列表（四态齐、五种来源徽标、可见性、满意度含「样本不足」） | 待补 |
| `ui-preview/skills-review-queue.png` | 待审核队列 + 两道门禁结论并排 + `[批准发布]` `[退回]` | 待补 |
| `ui-preview/skills-contract-viewer.png` | `[查看内容]` 只读契约三段视图 | 待补 |
| `ui-preview/skills-trial-run.png` | 试跑入口 + 结果 + schema 不符的失败态与可复制日志 | 待补 |
| `ui-preview/skills-version-chain.png` | 版本链时间线 + 「有新版本 vN+1 可用 `[升级到 vN+1]`」 | 待补 |
| `ui-preview/skills-disable-references.png` | 停用确认框 + 引用清单三栏（进行中项目 / 蓝本绑定 / agent 挂载）+ 影响预览 | 待补 |
| `ui-preview/skills-workflow-orchestration.png` | 项目 → 设置 → 工作流编排（三块） | 待补 |
| `ui-preview/skills-orphan-disposition.png` | 切模板 / 删环节的「N 条绑定与 M 条分工将丢失」处置清单 | 待补 |
| `ui-preview/skills-canvas-left-panel.png` | 画布左栏只读投影（含「因环节 03 载入」） | 待补 |
| `ui-preview/skills-chat-mount.png` | 对话「＋加技能」入口 + 选择器（分两段：本环节已绑定 / 可临时加载） | 待补 |
| `ui-preview/skills-message-rating.png` | AI 消息上的 👍/👎 + 填理由 | 待补 |
| `ui-preview/skills-feedback-aggregation.png` | 聚合项（归类徽标 + 👎 数与案例数两个口径 + `[看 N 个原始案例]`） | 待补 |
| `ui-preview/skills-proposal-diff.png` | 改进提案 diff + AI 起草/人工修改留痕 + 复核界面 | 待补 |
| `ui-preview/skills-promotion-block.png` | skill 详情页「来自组织大脑」区块（含真实空态） | 待补 |

---

## 四、ui-preview 三份 markdown 里与本束相关的已知缺口

> 这些是 `ui-preview/README.md` 记录的「UC 没写、由实现者替 UC 做了的决定」。
> 与本束相关的有四条，签核时请一并确认。

| S 编号 | 内容 | 为什么与本束相关 |
|---|---|---|
| **S-04** | 三个数值 UC 明写「需产品给出」，界面**拒绝编造**并用 `minSampleKnown: false` 标死。⚠ 中途曾出现过编造的 `sampleSize=18`、「口径表 v3」，制造「已算过、已过线」的假象，已删除 | 本束的**最小样本量 10 / 聚合浮现阈值 3** 是同一类东西（O-37 给了建议值但明写需产品确认）。⚠ **必须走 `packages/contracts/src/thresholds.ts` 的待定阈值登记表**，不得在 mock 或界面里写死 |
| **S-13** | 后台里三条被补的东西：新造第 7 个 agent「Forge」、18 台模型型号与定价全是编的、「可选范围」被降级为只读文字 | 本束的 skill 依赖模型选择（「只能选测试通过并已启用的模型」）建在这批编造数据上；`sk-promote` 的「MCP:欧盟法规库（待评审）」同理 |
| **S-02 / S-03** | 合规负责人不在角色模型里；访谈/问卷的场景角色不在 `ProjectRole` 四值内。实现用 `?as=` / `?view=` 两根预览轴绕过 | 本束需要的**能力维护者 / 方法论审核人 / 安全评审人 / 复核负责人 / 协同引导师**同样不在四值里。这是 S-02/S-03 的**第三、四个面**，建议合并裁决（见 `coverage.md` 缺口 12） |
| **S-14** | 危险动作都补了二次确认与影响范围（UC 只给了一个按钮） | 本束的**停用**沿用了这条（`DisableDialog` 的立即中断 / 跑完当前一轮）。⚠ 该二选一语义**复用自 T03**，是共享实现——本束不得再写第二份 |

`PROTOTYPE-DIGEST.md` 中与本束相关的三处（均为已建成投影，可作为截图取景依据）：
AI 发言头部 `skill: MECE 假设拆解` · 画布左栏「本环节绑定的 skill」（`提取假设 → 假设树 [运行]` /
`语音转便签 [已开]`）· 后台七模块导航（总览 / Agent / **Skill** / 模型 / MCP / 成员配额 / 反馈）。
