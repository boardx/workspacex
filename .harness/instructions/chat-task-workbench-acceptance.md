# Chat 任务工作台验收卡（Task Workbench Acceptance）

> **单一事实源**：这份文件是「`/chat` 是否把 CopilotKit + DeepAgents 的能力
> **转化成用户可理解、可控制的工作流**」这件事的唯一权威判据。
> 不要在别处（PR 描述、issue、代码注释、spec 头注）重新定义判据——**引用锚点，不要复制内容**。
>
> 起因（人类原话，2026-08-26 真实界面审计，`/chat` 新对话空状态打 **4/10**）：
>
> > 这更像传统聊天工具 + 文件侧栏，还没把 CopilotKit + DeepAgents 的核心价值——
> > 计划、状态、工具、审批、子任务、材料、产物——转化成用户可理解、可控制的工作流。
>
> 本仓硬规矩：**规范先行但没有脚本 = 未落地**（AGENTS.md 完成定义第 5/6 条的由来）。
> 因此本文件的每一条判据都必须能指向 `apps/web/e2e/chat-task-workbench-*.spec.ts`
> 里一条**会红的**用例。没有对应用例的条目 = 还没写完，不是「暂时豁免」。

---

## 一、四份评分卡的边界（同一事实不得声明在两处）

本仓已**五次**因「同一事实声明在两处」而漂移（设计 token / 字号档位 / 丢弃原因枚举 /
撤回链 SLA / 估点）。这份文件是第四份 chat 相关评分卡，边界必须先说清楚：

| 评分卡 | 评什么 | 一句话 | 提问方式 |
|---|---|---|---|
| `.harness/rubrics/chat-main-fidelity-rubric.md` | `/chat` 视觉/结构保真度 | 长得像不像原型 | 「照抄原型了吗」 |
| `.harness/instructions/chat-ux-acceptance-criteria.md` | chat 端到端行为体验 | 用起来像不像 Claude Code | 「回复流不流畅、工具透不透明」 |
| `.harness/rubrics/deepagent-capability-rubric.md` | agent 引擎/编排能力 | 引擎本身是不是行业顶级 | 「引擎做不做得到」 |
| **本文件** | **能力 → 工作流的信息架构与用户控制权** | **用户看不看得懂、控不控制得了** | **「引擎做得到的事，用户能不能理解并干预」** |

**判别口诀**：
- 引擎能产出结构化 todo 吗 → `deepagent-capability-rubric.md` **D1**。
- todo 在界面上实时可见吗 → `chat-ux-acceptance-criteria.md` **第 2 项**。
- todo **能不能被用户改顺序、删步骤、加约束，并且在执行前有一道确认门** → **本文件 TW-P0-3**。

三者不是一件事：引擎产出（能力）→ 界面显示（体验）→ **用户可控**（工作台）。
前两者已有权威卡，本文件只覆盖第三层与「信息架构」这一层。

### 明确回指（pointer，本文件不重复声明）

以下事实**不在本文件定义**，本文件只在用例里引用它们作为前置条件：

| 主题 | 权威在哪 | 本文件的位置 |
|---|---|---|
| 流式 token 是否逐个出现 | `chat-ux-acceptance-criteria.md` 第 1 项 | 不评 |
| 工具调用终态是否可见 | `chat-ux-acceptance-criteria.md` 第 3 项 / `deepagent-capability-rubric.md` D2 | 不评；TW-P0-7 只评**事件的措辞是否面向用户**与**子 agent 是否成树** |
| 「正在调用中」进行中态 | **人类 2026-08-10 已裁决走路径 B（不做）** —— 见 `chat-ux-acceptance-criteria.md` 人类裁决记录 | 本文件**不得**重新要求它；TW-P0-3 的「执行态进度」指的是 todo 步骤级完成比例，不是单次工具调用的在途态 |
| HITL 引擎侧三态是否打通 | `deepagent-capability-rubric.md` D6 | 不评；TW-P0-6 只评**界面上三个按钮是否都在**、风险分级与影响面展示 |
| 多轮上下文记忆 | `chat-ux-acceptance-criteria.md` 第 6 项 | 不评 |
| 语音转录必须服务端代理 | `chat-ux-acceptance-criteria.md` 结构性限制一节 | 不评；TW-P0-5 只评**麦克风入口数量**与录音态可见性 |
| 视觉配色/圆角/间距是否照抄原型 | `chat-main-fidelity-rubric.md` | 不评；TW-P2 只评**语义变量的使用**与**字阶层数**这类可机械判定的结构事实 |

### 新增维度声明（原三卡都没有）

以下**是本文件新增**，在 `chat-ux-acceptance-criteria.md`、`deepagent-capability-rubric.md`、
`chat-main-fidelity-rubric.md` 三份文件中逐条 grep 确认过不存在：

- 任务型空状态与任务模板（TW-P0-1）
- 能力卡的权限/记忆范围/可读材料披露（TW-P0-2）
- 六态工作流的**状态机本身**与计划确认门（TW-P0-3）
- 右栏动态 Inspector 的**按阶段自动切换**与无内容折叠（TW-P0-4）
- Composer 的结构与**麦克风入口去重**（TW-P0-5）
- 审批卡的**风险分级与影响面披露**（TW-P0-6）
- 子 agent 折叠树（TW-P0-7）
- P1 全部、P2 全部、无障碍全部、文案去开发者词汇

---

## 二、评分方式

- P0 七条，每条 0–1 分，共 **7 分**。
- P1 五条，每条 0.3 分，共 **1.5 分**。
- P2 + 无障碍 + 文案，合计 **1.5 分**。
- 总分 10 分，向下取整到 0.5。

分档标尺（沿用 `deepagent-capability-rubric.md` 的四级标尺，不另立一套）：

| 分值 | 含义 |
|---|---|
| **1.0** | 完全达成，全部子项在真栈 e2e 上绿 |
| **0.7** | 主干达成，缺 ≤1 个子项 |
| **0.3** | 形态存在但本质是降级/占位 |
| **0.0** | 完全缺失 |

**反伪造条款（沿用引擎卡，凌驾于所有条目）**：静态占位 UI、写死的模板文案、
点了没有真实后端读写的按钮，一律判 **0**，不因为「视觉上像」放宽。
本仓已九次「全绿但空转」，这份卡自己不能成为第十次。

---

## 三、P0 —— 决定能不能成为真正的 Agent 产品（7 分）

### TW-P0-1 任务型空状态

**判据**：
1. `/chat` 新对话中央主标题**不是**「开始新的对话」这类会话隐喻，
   而是任务隐喻：目标输入引导语，逐字包含「计划」与「确认」两个概念
   （参考文案：「今天想完成什么？描述目标，Agent 会先提出计划，得到确认后再执行」）。
2. 提供 **4 个真实任务模板**，覆盖四类：
   ① 调研市场并产出带来源的报告；② 阅读材料整理决策建议；
   ③ 需求拆成计划并生成项目产物；④ 分析数据发现异常并制图。
   模板必须**可点击且真的把目标填进输入框/发起任务**，不是纯装饰卡片。
3. 输入框上方显示**已挂载上下文标签**：项目 / 材料 N / 技能 N / 记忆范围。
   数字必须来自真实后端读取，不得写死。

**用例**：`chat-task-workbench-empty-state.spec.ts`
**锚点**：`chat-task-workbench-goal-headline`、`chat-task-workbench-template-{research|reading|planning|analysis}`、`chat-task-workbench-context-chip-{project|materials|skills|memory}`

### TW-P0-2 Agent 身份、能力与权限说明

**判据**：
1. 入口文案从「选择 Agent」改为「选择能力」，**默认自动匹配**、可展开。
2. 每张能力卡至少披露六项：擅长什么 / 可用工具与技能 / 能读哪些材料 /
   是否写文件或调外部服务 / 记忆范围（仅本对话 / 当前项目 / 长期）/
   当前状态（就绪 · 运行 · 等待审批 · 失败）。
3. 模型名、middleware、LangGraph 节点等**技术信息不出现在主界面**，
   收进「运行详情」。判定方式：主界面文本中不得出现 `langgraph` / `middleware` /
   模型 id 形态串（如 `qwen`/`claude-`/`gpt-`）。

**用例**：`chat-task-workbench-capability-cards.spec.ts`
**锚点**：`chat-task-workbench-capability-picker`、`chat-task-workbench-capability-card`、卡内 `...-facet-{strengths|tools|materials|writes|memory|status}`

### TW-P0-3 六态工作流与可编辑计划

**判据**：
1. 存在显式状态机：**准备 → 计划 → 执行 → 审批 → 完成 → 失败**，
   当前态在界面上可读（不是靠颜色暗示）。
2. 计划面板映射 DeepAgents `write_todos`，但**文案面向用户**
   （`✓ 理解需求` / `● 对比竞品` / `○ 生成报告`），不暴露 `write_todos` 字样。
3. 计划**可编辑**：调顺序、删步骤、加约束三个操作都在。
4. **确认门是条件性的**：复杂任务先确认计划，简单问题直接回答。
   反证要求：一个简单提问不得被加上一道确认门（否则判 0.3 封顶）。
5. 执行态显示：当前步骤、完成比例、耗时、**可暂停**。
6. 失败态说明失败步骤，并给出三个恢复动作：重试该步 / 修改输入 / 恢复检查点。

**用例**：`chat-task-workbench-workflow-states.spec.ts`
**锚点**：`chat-task-workbench-phase-indicator`（`data-phase` ∈ 六态）、
`chat-task-workbench-plan-panel`、`chat-task-workbench-plan-step`、
`...-plan-step-reorder`/`-delete`/`-add-constraint`、
`chat-task-workbench-plan-confirm`、`chat-task-workbench-run-progress`、
`chat-task-workbench-run-pause`、`chat-task-workbench-failure-{retry-step|edit-input|restore-checkpoint}`

### TW-P0-4 右栏动态 Inspector

**判据**：
1. 右栏四页签：**进度 / 材料 / 产物 / 运行详情**。
2. **按任务阶段自动切换**：上传材料 → 开「材料」；运行中 → 开「进度」；
   产出结果 → 开「产物」。（自动，不是用户手点）
3. **无内容时折叠**，不常驻占屏。判定方式：新对话空状态下右栏可见宽度
   ≤ 视口宽度的 1/12，或 `aria-expanded="false"`。

**用例**：`chat-task-workbench-inspector.spec.ts`
**锚点**：`chat-task-workbench-inspector`（`data-collapsed`、`data-active-tab`）、
`chat-task-workbench-inspector-tab-{progress|materials|artifacts|run-details}`

### TW-P0-5 统一 Composer

**判据**：
1. 第一行：多行任务输入（`textarea`，不是单行 `input`）。
2. 第二行左：附件/材料、`@Agent`、`/技能`、任务模式；右：语音状态 + 发送/停止。
3. 输入后显示：附件卡片、上下文范围、权限提示。
4. Agent 未就绪时**禁用发送并说明原因**（有可读文本，不只是灰掉）。
5. **麦克风入口全局唯一**——审计实测当前有两个重复入口。
   判定方式：composer 区域内匹配麦克风语义的可交互元素**恰好 1 个**。
6. 设备选择降为语音按钮的二级菜单；录音时显示计时 / 音量 / 取消 / 确认。

**用例**：`chat-task-workbench-composer.spec.ts`
**锚点**：`chat-task-workbench-composer`、`...-composer-input`、
`...-composer-mic`（唯一）、`...-composer-mic-devices`、
`...-composer-recording-{timer|level|cancel|confirm}`、`...-composer-send-disabled-reason`

### TW-P0-6 审批卡片（三态决策）

**判据**：
1. 界面必须同时具备 **approve / edit / reject** 三个按钮
   （DeepAgents 原生支持三态，只做一个「确认」判 0.3 封顶）。
2. 卡片披露五项：Agent 想做什么 / 为什么 / 影响哪些文件记录或外部对象 /
   参数或变更 diff / **风险等级**。
3. 风险分级生效：读操作可静默；写入、删除、发送、支付、发布必须弹审批。
   反证要求：一次纯读操作**不得**弹审批卡。

**用例**：`chat-task-workbench-approval.spec.ts`
**锚点**：`chat-task-workbench-approval-card`（`data-risk`）、
`...-approval-{approve|edit|reject}`、`...-approval-facet-{intent|rationale|impact|diff|risk}`

### TW-P0-7 工具与子 Agent 事件

**判据**：
1. 只展示**可审计事件**，措辞面向用户：
   「研究 Agent 正在检索 8 个来源」「数据 Agent 已分析 2430 行」
   「已生成 市场分析报告.docx」「写入失败：目标文件无权限」。
   判定方式：事件行文本中不得出现裸工具名/裸 JSON/裸枚举值。
2. **不暴露隐藏思维链**：界面不得渲染 `reasoning`/`thinking` 原文。
3. 子 Agent 用**可折叠树**：默认摘要，展开看输入 / 工具 / 耗时 / 结果。

**用例**：`chat-task-workbench-tool-events.spec.ts`
**锚点**：`chat-task-workbench-event-row`、`chat-task-workbench-subagent-node`
（`aria-expanded`）、展开后 `...-subagent-detail-{input|tools|duration|result}`

---

## 四、P1 —— 决定能不能高效使用（1.5 分，每条 0.3）

| 编号 | 判据 | 锚点 |
|---|---|---|
| **TW-P1-1** | 对话**自动命名**与状态管理：线程列表不得一屏全是「新对话」，且不得出现「0 个 agent」这类内部措辞 | `chat-task-workbench-thread-title` |
| **TW-P1-2** | **材料预加载**：允许在选线程之前就加材料（当前必须先选线程） | `chat-task-workbench-preattach-dropzone` |
| **TW-P1-3** | 结构化工具事件与子 Agent 摘要（TW-P0-7 的持久化侧：刷新后仍在） | 复用 P0-7 锚点 + 刷新 |
| **TW-P1-4** | 产物**预览 / 来源 / 版本 / 导出**四件齐 | `chat-task-workbench-artifact-{preview|sources|versions|export}` |
| **TW-P1-5** | 暂停、恢复、重试单步、检查点恢复四个控制动作真实可点 | 复用 P0-3 锚点 |

---

## 五、P2 精致度 + 无障碍 + 文案（1.5 分）

### P2 精致度（0.5 分）
- **TW-P2-1** 中央内容最大宽度 720–880px（输入框不得横跨全屏）。**可机械测量**。
- **TW-P2-2** 减少大面积边框，靠背景层级/间距/局部卡片建立结构。
- **TW-P2-3** 标题/正文/辅助**至少三个字阶**（computed `font-size` 去重后 ≥3）。**可机械测量**。
- **TW-P2-4** 灰色辅助文字对比度达标（见无障碍）。
- **TW-P2-5** 颜色/间距/圆角/阴影全部走设计系统**语义变量**，页面不得自创
  （判定：关键节点的 computed 值须能回溯到 `--` token，不得出现裸 hex）。
- **TW-P2-6** 对话列表有选中态 / 悬停操作 / 置顶 / 搜索 / 更多菜单。
- **TW-P2-7** Skeleton + 空态 + 错误态 + 恢复态四态齐。
- **TW-P2-8** 动画只用于状态迁移（计划展开 / 步骤完成 / 产物生成 / 审批暂停）。

**用例**：`chat-task-workbench-polish.spec.ts`

### 无障碍（0.7 分）—— 人类明确要求实测，截图只能看出风险
- **TW-A11Y-1** 对比度（axe `color-contrast`，`@axe-core/playwright` 仓库已装）。
- **TW-A11Y-2** 小图标与圆形按钮**点击区 ≥ 24×24 CSS px**。
- **TW-A11Y-3** 仅图标按钮有**可访问名 + Tooltip**。
- **TW-A11Y-4** Agent 状态 / 工具完成 / 审批请求有 **live region 播报**
  （`role="status"` 或 `aria-live`）。
- **TW-A11Y-5** 弹窗**焦点锁定 + Esc 关闭 + 返回原焦点**。
- **TW-A11Y-6** 语音状态**不能只靠颜色**（须并存文本或图标差异）。
- **TW-A11Y-7** **200% 缩放**、窄屏重排不横向滚动。
- **TW-A11Y-8** Tab 顺序与焦点可见性。

**用例**：`chat-task-workbench-a11y.spec.ts`

### 文案（0.3 分）
- **TW-COPY-1** 界面不得暴露内部概念。**黑名单（逐字）**：
  `0 个 agent`、`选择线程后读取`、`thread`、`write_todos`、`langgraph`、
  `middleware`、`checkpoint_id`、`visibilityScope`、裸 UUID。
  替换为用户语言 + 明确动作。

**用例**：`chat-task-workbench-copy.spec.ts`

---

## 六、取证纪律

1. **必须真栈**：`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- <cmd>`，
   退出码**直接取**——`cmd | grep` 的 `$?` 是 grep 的，会一路往「绿」的方向骗人
   （本仓已据此在 issue 上写过错话）。
2. **不许 `test.skip`**：能力不存在时，用例必须**失败**并在失败信息里写明
   「该能力当前不存在，锚点待实现为 `data-testid=X`」。skip 掉的差距等于不存在。
3. **新 spec 必须进 `apps/web/playwright.chat-read.config.ts` 的 `testMatch`**——
   漏加是静默的（playwright 报 `No tests found` 退 1，看起来像 spec 写坏了），
   由 `.harness/scripts/lint-spec-gate-coverage.mjs` 机械门控。
4. **打分必须声明实测 SHA**，并附命令输出 / 截图路径。
   文档里写着 ✅ **不算证据**（静态痕迹 ≠ 动态事实）。

---

## 七、评分史（append-only，最新在上）

| 日期 | SHA | P0-1 | P0-2 | P0-3 | P0-4 | P0-5 | P0-6 | P0-7 | P1 | P2/A11Y/COPY | 总分 | 证据 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-08-26 | 48fb9889 | 0.0 | 0.3 | 0.3 | 0.3 | 0.3 | 0.7 | 0.3 | 0.0 | 0.4 | **2.5** | 真栈 `playwright.chat-read.config.ts`，44 tests：run2（5 workers）40 failed / 4 passed，run3（2 workers，复跑 run2 里 8 条基础设施噪声 + 3 条 spec 自身缺陷修复后）9 failed / 3 passed。合并后 **7 通过 / 37 真实缺口**。日志见 issue #2068 评论。|

> **首轮基线说明（2026-08-26，实测 SHA `48fb9889`）**
>
> 人类同日目视审计给 **4/10**，本卡机械实测给 **2.5/10**。**这不是分歧，是口径差**：
> 人类评的是「新对话空状态」这一屏；本卡还评了控制权（暂停/恢复/重试单步/检查点
> 恢复，四个全缺）、无障碍（7 条中 5 条红）与 P1 效率（5 条全红）——那是一张截图
> 照不出来的面。**不向人类的分数取整**：低的那个才是差距清单的真实长度。
>
> **P0-6 给 0.7 的理由与保留**：approve/edit/reject 三态决策 UI 真实存在且
> e2e 实测通过（`copilotkit-v2-panel.tsx:455` 决策变体），不是降级实现，故不判 0.3。
> 但披露五项与风险分级两个子项全缺，且 `DEEP_AGENT_HITL_TOOLS` 在**所有部署配置里
> 都未设置**——即真实用户根本触发不到它。该保留已单列进实施清单。
>
> **本轮记录在案的三条 spec 自身缺陷**（不是产品缺口，已修，留作反例）：
> ① TW-P2-5 裸 hex 正则把注释里的 issue 号当颜色（假阳性，修后**通过**）；
> ② TW-P0-6① 锚到了 `hitl-dialog` 的终态变体而非决策变体——同一个 testid 挂在
> 两个 DialogContent 上，差点据此写下「三态按钮不存在」这句错话（修后**通过**）；
> ③ TW-P0-5④ 用 503 打死 agents 端点来诱发未就绪，把被测表面一起打死了。
> 三条都是「用例红了 ≠ 产品坏了」的实例：**先自证用例，再报缺口**。

## 八、人类签署

- 签署人：_待签_
- 日期：_待签_
- 裁决：☐ 按本文件生效

> ⚠ 签署是**人的动作**，agent 不许自己改这一节的 status。
> 未签署期间本文件已可作为差距清单使用，但不得据此宣布某个 feature `passing`。
