# 契约束 `plan-control` — ① UI（签核面第 ① 件）

> **自检：本文件引用 8 张截图，`ui-preview/plan-control/` 目录下实际 8 张。N == M == 8。**（2026-08-26 ui-prototyper 交付）

# ✅ 八屏已产出：第 ① 件**材料齐备**，`status` 仍待人类 Approve

本束的 8 屏（G-01 ～ G-08）已由 `ui-prototyper` 用 `apps/web` 真实组件 + mock 数据产出，
截图落在 `ui-preview/plan-control/`（见下方第三节「已产出」表）。
**`lint-ui-material.mjs` 对本束的判定④「目录 0 张 png」已随之回绿**——材料从「已声明、待产出」
转为「已产出、待人类核对」。⚠ 材料齐备 ≠ 签核通过：`design-signoff.md` 的
`status` / `confirmed_*` / `confirmed_via` 在人类 Approve 之前继续留空（ADR-023 决策五）。

## ✅ 已裁决（人类，2026-08-26）：**八屏全补齐再签**

**裁决逐字**：「**八屏全补齐再签**」——三个候选（补一屏 / 零截图签 / 八屏全补）里
**选了最严的那个**，比我推荐的「先补 G-02 一屏」更严。

⇒ **签核动作往后推**：`ui-prototyper` 把下面第三节点名的 **G-01 ～ G-08 全部八屏**
补进**同一个分支** `signoff/plan-editing`，人类**一次性 Approve**
（只做一次动作，`human-decision-packaging.md` 规则二；分成两个 PR 就要点两次，违背打包流程）。

⇒ **顺带解决上面那条红**：八屏补齐后 `lint-ui-material` 对本束应当**回绿**。
补完由本束负责核对两件事，**核不过不许说补好了**：
① 门控真的回绿（**退出码直接取，不穿管道**——`cmd | grep` 的 `$?` 是 grep 的）；
② **`ui.md` 里 G-01 ～ G-08 的描述与实际截图逐张对得上**——
   描述和图不符是本仓判 0 的那类问题，不是小瑕疵。

⚠ **拿到答案 ≠ 签核。** `design-signoff.md` 的 `status` / `confirmed_*` / `confirmed_via`
在人类 Approve 之前**继续留空**（ADR-023 决策五的信任边界）。

---

## 一、本束需要哪几块屏

本束**不新建路由**。全部落点都在 `/chat` 主屏的既有三栏骨架内，
宿主屏本身归 `chat` 束（`chat/ui.md` 的 S1）。本束只往里加**四个区域**：

| 屏 | 一句话 | 路由 | 落在哪 | 现状 |
|---|---|---|---|---|
| **S1** | **六态指示器**（准备/计划/执行/审批/完成/失败） | `/chat` | 消息流顶部 | **未建** |
| **S2** | **计划面板 · 只读态** | `/chat` | 消息流内联卡片 | **已建成但形态不对**：现在是 `WriteTodosCard`，数据由 `write_todos` 的 `toolArgsSummary` 反解，**不是读账本** |
| **S3** | **计划面板 · 编辑态**（调序 / 删步 / 加约束） | `/chat` | 同 S2 | **未建** |
| **S4** | **确认门**（条件性出现） | `/chat` | 计划面板底部 | **未建** |
| **S5** | **执行态进度条 + 暂停** | `/chat` | 六态指示器下方 | **未建** |
| **S6** | **失败态 + 恢复动作** | `/chat` | 消息流内联 | **未建** |
| **S7** | **孤儿约束提示**（I-8） | `/chat` | 计划面板内 | **未建** |
| **S8** | **执行中编辑的「下一步生效」告知**（I-11） | `/chat` | 编辑态内 | **未建** |

---

## 二、三个编辑动作长什么样（签核第 ① 件的正文）

> ⚠ 下面每一处交互都必须对应 `usecases.md` 里一条真实的读写 UC。
> TW 卡的反伪造条款逐字：**点了没有真实后端读写的按钮，一律判 0**。
> 每条后面括号里标的就是它依赖的 UC——**标不出来的不许画**（`contract-design.md` §五-8）。

### 2.1 计划面板的两个态

**只读态（S2）** —— 默认。每行一条步骤：

```
✓ 理解需求
● 对比竞品            ← in_progress，带一条细进度线
○ 生成报告
     ↳ 只用公开可引用的来源        ← 约束，缩进挂在宿主步骤下
```

- 图标即状态，**但状态同时有文本**（`completed` / `in_progress` / `pending` 三态
  各有一个 `aria-label`，无障碍 TW-A11Y-6：不能只靠图标形状）。
- **不出现 `write_todos` 字样**（判据二；黑名单在 TW-COPY-1，本文件不重抄）。
- 面板右上一个「编辑计划」按钮 → 切到编辑态。

**编辑态（S3）** —— 三个动作全在这一屏，不再套第二层弹窗：

| 动作 | 交互 | 锚点 | 依赖的 UC |
|---|---|---|---|
| **调顺序** | 每行左侧拖拽把手；键盘可达（`↑`/`↓` + `Alt`，TW-A11Y-8） | `chat-task-workbench-plan-step-reorder` | **UC-3** `reorderPlanStep` |
| **删步骤** | 每行右侧「移除」；**无二次确认弹窗**（可撤销代替，见下） | `chat-task-workbench-plan-step-delete` | **UC-4** `deletePlanStep` |
| **加约束** | 每行下方「+ 加一条约束」→ 就地展开单行输入 | `chat-task-workbench-plan-step-add-constraint` | **UC-5** `addPlanConstraint` |
| **撤约束** | 约束行悬停出现「×」 | `chat-task-workbench-plan-constraint-remove` | **UC-6** `removePlanConstraint` |

⚠ **删步骤为什么不做二次确认**：账本是 append-only（I-2），
上一版永远还在。正确的形状是**删除后浮出一条「已移除『生成报告』· 撤销」**，
`撤销` 就是一次基于旧 revision 的重放。二次确认弹窗只是把成本前置给每一次正确操作。
**请人类确认这个取舍**（`design-signoff.md` ① 节）。

### 2.2 冲突与并发怎么被用户看见（I-5 / I-11 的界面面）

这两条不变量如果没有界面面，就等于没有。

- **`PLAN_REVISION_CHANGED`（I-5）**：编辑提交时 agent 刚好写了新快照 ⇒
  面板顶部浮出一条**非模态**的横条：
  「Agent 刚更新了计划，你的改动没有丢——查看差异 / 重新应用」，
  锚点 `chat-task-workbench-plan-stale-banner`。
  ⚠ **不许直接丢弃用户的输入，也不许静默覆盖 agent 的新版**。两者都是数据丢失。
- **执行中编辑（I-11）**：编辑态在有活跃 run 时顶部常驻一行
  「Agent 正在执行。你的改动会在当前步骤完成后生效。要立刻生效请先暂停。」
  锚点 `chat-task-workbench-plan-pending-apply`，其中「暂停」直接触发 **UC-9**。
  ⚠ 这行文案不是装饰，它是 `domain.md` 第三节 ③ 那条产品行为的唯一告知处。
- **孤儿约束（I-8，S7）**：面板底部
  「1 条约束失去了对应步骤：『只用公开可引用的来源』（原属「生成报告」）· 重新挂载 / 移除」，
  锚点 `chat-task-workbench-plan-orphan-constraint`。

### 2.3 六态指示器（S1，判据一）

一行常驻，**当前态是可读文本，不是颜色**：

```
准备 › [计划] › 执行 › 审批 › 完成
```

- 锚点 `chat-task-workbench-phase-indicator`，`data-phase` ∈ 六值（`domain.md` 第一节 5）。
- 当前态**同时**有：文本高亮 + `aria-current="step"` + 一段 `role="status"` 播报
  （TW-A11Y-4）。**去掉 CSS 后仍然能读出现在在哪一态**——这是判据一「不靠颜色暗示」的判定方式。
- `failed` 态不出现在这条线上（它不是第六格），而是**替换整条**为一行失败摘要 → S6。
- ⚠ **数据来自 `getPlanLedger.phase`（UC-1），前端不重算**（I-7）。

### 2.4 条件性确认门（S4，判据四）

- 锚点 `chat-task-workbench-plan-confirm`。
- **渲染条件唯一**：`getPlanLedger.gate.required === true`（UC-8 的判定结果）。
  前端**不得**自己判断「这看起来像个复杂任务」。
- 简单提问路径上这个节点**从不进入 DOM**（不是 `display:none`）——
  `usecases.md` UC-8 的反证第 ③ 条要断言的正是这一点。
- 门上两个出口：`确认并执行`（**UC-7**）与 `继续编辑`（回 S3）。
  ⚠ **不做「跳过确认」第三个出口**：那会让门变成装饰。

### 2.5 执行态（S5，判据五）与失败态（S6，判据六）

**S5**：`当前步骤：对比竞品 · 2/3 · 已用 1 分 12 秒`，右侧一个「暂停」。
- 锚点 `chat-task-workbench-run-progress`、`chat-task-workbench-run-pause`（**UC-9**）。
- ⚠ 「耗时」必须是真实的 run 起止差（`getPlanLedger.progress.elapsedMs`），
  不是前端起的一个计时器——刷新后它必须还是对的。
- ⚠ 「暂停」的文案与 I-12 的真实语义（中止当前 run）必须一致。
  若人类接受「暂停 = 中止后可重开一轮」，文案建议直接写**「停止」**，不写「暂停」。
  **这条请人类拍**（`design-signoff.md` ① 节）。

**S6**：`第 3 步「生成报告」失败：目标文件无权限`，下面三个动作：

| 按钮 | 锚点 | 依赖的 UC | 状态 |
|---|---|---|---|
| 重试该步 | `chat-task-workbench-failure-retry-step` | **UC-10** | ✅ 有契约 |
| 修改输入 | `chat-task-workbench-failure-edit-input` | **UC-3/4/5**（回编辑态）+ UC-7 | ✅ 有契约 |
| ~~恢复检查点~~ | ~~`chat-task-workbench-failure-restore-checkpoint`~~ | ~~UC-11~~ | ✅ **本轮明确不做 —— 按钮不渲染**（见下） |

✅ **「恢复检查点」本轮明确不做 —— 人类 2026-08-26 裁决 (c)**（`domain.md` 三·②）。

**这个按钮不渲染**，锚点不存在，e2e **不许 `test.skip`**，要如实报缺口。
**绝不渲染一个点了报错的按钮**——那是反伪造条款的死按钮，判 0。

⚠ 裁决是在知情状态下做的：人类看到的是「`replayAgentRun` **不是**从 checkpoint 继续跑」
「`agent-runtime/coverage.md:249` **自己**把它标成缺口 25」「引擎原语实存但本仓一行没接」
这三条摆出来之后，才选的 (c)。
**判据六没有被改松，它仍然要求三个恢复动作**——是我们**明确选择不做第三个**，
TW-P0-3 的分数如实封顶 **0.7**。所以 **G-08 那张图按两个恢复动作画**。

---

## 三、第 ① 件材料缺口 —— 需要 `ui-prototyper` 产出的 8 屏

> ⚠ 按 `contract-design.md` 的写作约定第 2 条，缺口条目**不写成 `.png` 路径**
> （写成路径会被门控判为死链）。下面是文字描述。

| # | 缺哪张 | 对应屏 | 为什么非它不可 |
|---|---|---|---|
| **G-01** | 计划面板只读态，三种步骤状态同屏 | S2 | 判据二「文案面向用户」要看图才能签 |
| **G-02** | 计划面板编辑态，三个动作的控件同屏 | S3 | **判据三的全部**。没有这张，第 ① 件对本束的核心一件为零 |
| **G-03** | 拖拽进行中的中间态 | S3 | 调序是唯一有中间态的动作 |
| **G-04** | 约束就地展开输入 + 已挂载一条约束的样子 | S3 | 「加约束」的形态是本束最不确定的一件（`domain.md` 第三节 ①） |
| **G-05** | 六态指示器的六个态各一张（或一张六联） | S1 | 判据一要签「不靠颜色暗示」，只能看图 |
| **G-06** | 确认门出现时的整屏 + **简单提问路径的整屏对照** | S4 | 判据四是**一对**对照，单张不足以签 |
| **G-07** | 执行态进度 + 暂停；以及执行中编辑的告知条 | S5 / S8 | I-11 的告知是产品承诺，要看措辞 |
| **G-08** | 失败态 + **两个**恢复动作（重试该步 / 修改输入）。**不画「恢复检查点」** | S6 | 裁决 (c) 已定：第三个动作本轮不做，按钮不渲染 |

### 已产出（2026-08-26 ui-prototyper 交付，`ui-preview/plan-control/`）

> 预览路由 `/preview/plan-control?screen=g01..g08`（纯 mock，不接后端）；
> 组件 `apps/web/components/plan-control/plan-control-screens.tsx`，落点在 `/chat` 三栏骨架内。

| # | 截图 | 对应 ui.md 哪一条 |
|---|---|---|
| **G-01** | `g-01-plan-readonly-three-status.png` | 2.1 只读态（S2）：三种步骤状态同屏 + 约束缩进，无 write_todos（判据二） |
| **G-02** | `g-02-plan-edit-actions.png` | 2.1 编辑态（S3）：调序/删步/加约束/撤约束四动作 + 删后「撤销」浮条 |
| **G-03** | `g-03-plan-reorder-dragging.png` | 2.1 调序中间态（S3，UC-3）：抬起 + 落点高亮 |
| **G-04** | `g-04-constraint-inline-input.png` | 2.1 加约束就地输入 + 已挂载一条；附 S7 孤儿约束（I-8）与 I-5 陈旧横条 |
| **G-05** | `g-05-phase-indicator-six-states.png` | 2.3 六态指示器（S1，判据一）：六联，failed 替换整条 |
| **G-06** | `g-06-confirm-gate-vs-simple.png` | 2.4 确认门（S4，判据四）：required=true 对照 required=false（简单提问节点不入 DOM） |
| **G-07** | `g-07-run-progress-and-pending-apply.png` | 2.5 执行态（S5，UC-9）+ 2.2 执行中编辑告知条（S8，I-11） |
| **G-08** | `g-08-failure-two-recovery.png` | 2.5 失败态（S6，判据六）：仅两个恢复动作，「恢复检查点」按钮不渲染（裁决 c） |

### 缺口小结（可机械核对）

| | |
|---|---|
| 本文件引用的截图 | **8** |
| `ui-preview/plan-control/` 实存 | **8** |
| 点名的缺口 | **0**（G-01 ～ G-08 已全部产出） |

---

## 四、`data-testid` 前缀（供后续 verification 锚定）

全部沿用 TW 卡 TW-P0-3 已声明的锚点，**本文件不新造一套**
（锚点的单一事实源是 `.harness/instructions/chat-task-workbench-acceptance.md`）：

```
chat-task-workbench-phase-indicator          （data-phase ∈ 六态）
chat-task-workbench-plan-panel
chat-task-workbench-plan-step
chat-task-workbench-plan-step-reorder
chat-task-workbench-plan-step-delete
chat-task-workbench-plan-step-add-constraint
chat-task-workbench-plan-confirm
chat-task-workbench-run-progress
chat-task-workbench-run-pause
chat-task-workbench-failure-retry-step
chat-task-workbench-failure-edit-input
chat-task-workbench-failure-restore-checkpoint
```

本束**新增**四个（TW 卡未列，因为它们是 I-5 / I-8 / I-11 的界面面，
卡上只写了判据不写不变量的告知面）：

```
chat-task-workbench-plan-constraint-remove   （UC-6）
chat-task-workbench-plan-stale-banner        （I-5）
chat-task-workbench-plan-pending-apply       （I-11）
chat-task-workbench-plan-orphan-constraint   （I-8）
```

⚠ 这四个是**新增锚点**，签核时请一并确认；它们**不进 TW 卡**
（TW 卡是判据的单一事实源，不是锚点登记簿），只登记在本文件。

---

## 五、这一件签核时要看什么

- [x] ~~零截图签不签~~ —— **已裁决：八屏全补齐再签**（人类 2026-08-26，见本文件顶部）。
- [ ] **删步骤不做二次确认、改用「已移除 · 撤销」**（2.1 末尾）。
- [ ] **「暂停」还是「停止」**——文案必须与 I-12 的真实语义一致（2.5）。
- [x] ~~「恢复检查点」按钮渲不渲染~~ —— **已裁决 (c)：不渲染**（人类 2026-08-26）。
- [ ] **执行中编辑的告知文案**（2.2）——这是 I-11 那条产品行为对用户的唯一出口。
- [ ] **四个新增锚点**（第四节末）是否接受。
