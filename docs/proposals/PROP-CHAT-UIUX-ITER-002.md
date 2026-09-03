# Chat UIUX 第二轮迭代计划（PROP-CHAT-UIUX-ITER-002）

> **状态：计划，待排入 sprint 逐条开工。** 输入是人类 2026-08-30 转述的一份外部 UX 评审
> （参照 ChatGPT / Claude / Cursor / Linear / Notion AI），聚焦 5 点：① Agent 执行反馈弱
> ② 主区域缺阅读轴 ③ Composer 功能过载 ④ 右栏价值密度低 ⑤ Mode/Skill/Tool/Task 心智模型混乱。
> **本文档只排"真差距"，不重做已经落地的东西**——先核实现状，是这份计划和一份"照单全收"
> 的清单之间的区别。范围纪律：只动 UIUX 呈现，不改业务逻辑（run 编排、契约、数据模型不动）。

## 零、为什么先核实现状（不能拿到反馈直接照单开工）

反馈描述的截图状态（"正在准备…已用 42 秒"出现两次、composer 同屏 7-8 个按钮、右栏常驻
23% 屏幕）与 `origin/main` 当前实现有明显落差——`chat-task-inspector.tsx` / `agent-plan-panel.tsx`
/ `copilotkit-v2-panel-body.tsx` 这条活体路线已经过 #2068/#2075/#2130/#2260/#2321 等多轮
issue 迭代，很大一部分反馈点已经用**更严谨**的方式解决了（真实 step 派生，不是伪造的固定
四阶段）。照单全收会：①重做已完成的工作 ②可能把"真实但细粒度"的信息倒退成"好看但编造"
的信息，违反本仓"不合成/不伪造进度"的硬纪律。所以先逐条核对，再定真差距。

## 一、逐条核实：反馈 vs 活体现状

| # | 反馈点 | 活体现状（文件:行） | 结论 |
|---|---|---|---|
| P0-1 | "正在准备…已用 42 秒"同屏出现两次，看不出在做什么 | `copilotkit-v2-panel-body.tsx:789-807` 的头注明确记录了同一个人类反馈（issue #2068 第二件，2026-08-26）并已合并成**一处**：气泡内一条状态行（阶段文案 + 已用秒数 + 45s 提示 + 当前计划第几步），右栏「进度」页签（`chat-task-inspector.tsx:330-372`）是它的**全量展开版**，两处不同粒度、同一份数据源（`ProgressTab`/`planStep` 共用 `usePlanLedgerPolling`），不是两处各转各的 | **已解决**（重复显示问题不存在；"看不出在做什么"部分见下 V2） |
| P0-2 | 用户问题漂在右上、Agent 状态漂在左上，无统一阅读轴 | `copilotkit-v2-panel-body.tsx:1159-1165`：消息列表 + composer + 追问 chips + 运行状态条统一收进 `max-w-3xl`（768px，落在原反馈建议的 720-900px 区间），头注明确写了"此前 `max-w-3xl` 只包着消息列表内部……现在统一"（issue 追踪见该行上方注释） | **已解决** |
| P1-3 | Composer 同屏材料/Deep Research/技能/PDF/任务模式/语音/麦克风/loading 等一大堆 | 已是两行结构（issue #2075/#2130）：第一行纯输入，第二行左「附件 / @Agent（`CapabilityPicker` 六项披露卡片）/ `/技能`（`ChatSkillMountPanel`）/ 任务模式 toggle」，右「麦克风 + 发送/停止」——`copilotkit-v2-panel-body.tsx:1644-1660` 注释写明"麦克风唯一入口，设备选择降为二级菜单"。原反馈里的"PDF 文档生成"等具体能力已经不是常驻按钮，而是 `CapabilityPicker`/`技能` 面板里的可选项 | **部分解决**：披露层级比反馈描述的截图好得多，但第二行仍**同时**常驻 4 个控件（附件/@Agent/技能/任务模式）+ 麦克风 + 发送 = 6 个，比反馈建议的"默认只留附件/模式/发送"更密——这是真差距，见下 V1 |
| P1-4 | 右栏占 23% 屏幕、价值密度低，应默认折叠、有内容才展开 | `chat-task-inspector.tsx` 头注（issue #2068 TW-P0-4）逐字写着同一个判断——"人类 2026-08-26 审计原话：不许常驻占六分之一屏"，已实现折叠态（w-10 图标条）/展开态（w-72）+ 五个页签（进度/材料/产物/编制/运行详情）+ `isInspectorCollapsed` 按信号自动判定 + 2026-08-30 刚修过的手动收起覆盖态 bug | **已解决**（且比反馈建议的实现更细：还处理了"手动收起 vs 自动展开"的优先级冲突） |
| P1-5 | Mode/Skill/Tool/Task 四个概念混淆，把 Agent 架构暴露给用户 | composer 上仍直接用「/技能」「任务模式」两个系统内部词汇作为控件文案；右栏「运行详情」页签（`chat-task-inspector.tsx:383-407`）目前只列线程 id/运行状态/阶段/耗时，不含"当前用的是什么模式"这一条 | **未解决**：真差距，见下 V3 |

## 二、真实差距 → 迭代项（按无需签核优先 · 碰撞面从低到高排序）

> 执行纪律沿用 `CHAT-10-ITER-PLAN.md` 已验证有效的一套：一次一个 issue 一个 PR；
> 绝不假 UI（没有真实数据支撑的状态不展示）；不新增字段/端点就能做的优先做；
> 验证走真栈 e2e（`shots:chat-main` / `verify:chat-read` / 对应 CK 系列 spec），
> 不接受"看代码 diff 就算完成"。

| 版本 | 改进 | 对应反馈 | 范围 | 契约/签核 | 碰撞面 |
|---|---|---|---|---|---|
| **V1** | Composer 第二行收敛：附件 / @Agent / `/技能` / 任务模式四个常驻控件收进一个「更多」入口（复用已有的 `CapabilityPicker` 六项披露卡片模式，不新造一套披露组件），默认只留输入框 + 麦克风 + 发送/停止；任务模式因为**真实影响发出的正文**（`copilotkit-v2-panel-body.tsx:1626` 注释：会话级、非纯装饰），保留为常驻 toggle 不收进「更多」——反馈里"模型模式"级别的开关本就该常驻，不是要藏起来的次要能力 | P1-3 | 纯前端，复用现有 `CapabilityPicker`/`ChatSkillMountPanel` 组件与既有 testid，不改它们内部行为 | 否 | 低（改的是容器组装，不改子组件） |
| **V2** | Thinking 卡片里的阶段文案，从「一句细粒度 phase label」升级为「细粒度文案 + 一个小的宏观阶段指示」：宏观阶段桶（如"准备/执行/收尾"）**必须是从现有 `AgentRunStepKind`/`toolName` 映射表（`agent-run-phase.ts`）派生的纯函数分组**，不是新建一套独立状态。未知 kind 一律落已有 `FALLBACK_PHASE` 兜底，不新增编造分类 | P0-1（"看不出在做什么"的残留部分） | 纯前端派生函数 + 渲染，复用 `agent-run-phase.ts` 现有映射表 | 否（不动契约，只加一层分组函数） | 低 |
| **V3** ✅ | 术语脚手架：composer 上「/技能」「任务模式」两个按钮加 `title`/`aria-label` 说明性文案（如"任务模式：先给计划、确认后再执行的问答方式"），右栏「运行详情」页签补一条"当前模式"（任务模式开/关，真实读取 `taskMode` state，不是新状态源） | P1-5 | 纯前端，文案 + 一个已有 state 的展示行 | 否 | 低 |
| **V4** | 视觉打磨收尾：核对 `max-w-3xl` 阅读轴在 V1 收敛 composer 后是否仍然一致（改动 composer 布局后回归一次视觉 fidelity），补齐 `chat-main-fidelity-rubric.md` 相关截图 | P0-2 回归验证 | 纯前端 + 截图证据 | 否 | 低 |

**明确不纳入本轮**（已经用更严谨的方式实现，重做是倒退或重复劳动）：
- 右栏自动折叠/展开（P1-4）——已完整实现，含边界 bug 修复（2026-08-30）。
- 消息区阅读轴收拢（P0-2）——已实现，V4 只是收敛 composer 后的回归检查，不是重新做。
- "正在准备"重复显示（P0-1 的重复部分）——已合并为一处，不重复劳动。
- 固定的"理解任务→制定计划→搜索/分析→生成结果"四段式 checklist——**刻意不做**：这四段是
  反饋建议的一套通用文案，但本仓的纪律是"只显示真实派生的信息，不为了好看编一套阶段"
  （`agent-run-phase.ts` 头注逐字写明这条取舍）。V2 的宏观阶段桶必须保持"从真实 step 映射
  聚合"这条边界，不能滑向"先定四个好看的阶段名、再找信息往里塞"。

## 三、执行台账（逐条回填）

| 版本 | 状态 | 说明 |
|---|---|---|
| V3 | ✅ 已实现（本分支） | 实现时复核发现 composer 上「/技能」「任务模式」两个控件其实**已经**有 `title`/`aria-label` 说明文案（`copilotkit-v2-panel-body.tsx:1632`、`chat-skill-mount-panel.tsx:486`，均早于本轮），本条真差距只剩「运行详情」页签补「当前模式」行——已完成：`taskMode` 状态从 `copilotkit-v2-panel-body.tsx` 经 `copilotkit-v2-panel.tsx`/`copilotkit-v2-shell.tsx` 透传给 `chat-task-inspector.tsx` 的 `RunDetailsTab`，未传时不显示（不编造默认值）。新增单测 `tests/ui/chat-task-inspector-task-mode.test.tsx`（3 例）。验证：`tsc --noEmit` 0 错误、`lint:design` 全过、`vitest run tests/ui` 204 files/1657 tests 全过、`lint-spec-gate-coverage.mjs` 全绿。 |
| V1 | 待排 | Composer 第二行收敛——涉及重排 4 个常驻控件的可见性，触及现有 e2e 断言的控件可见位置最多（`chat-task-workbench-composer-*` 系列锚点分布在 6+ 个 e2e spec、十余处单测），需要单独一轮逐条核对 e2e 后再动，不与其他改动混在一起 |
| V2 | ✅ 已实现（本分支） | `useCopilotKitV2RunProgress`（`copilotkit-v2-run-progress.ts`）新增 `stage: "preparing"｜"acting"｜"replying"｜null` 三桶，精确对应已有的三类 AG-UI 事件（`RUN_STARTED`/`TOOL_CALL_START`/`TEXT_MESSAGE_START`），`RUN_FINISHED`/`RUN_ERROR` 清空。thinking 卡片新增一行紧凑指示（`准备 → 执行 → 回复`，当前态高亮），testid `copilotkit-v2-thinking-stage`。明确不是 TW-P0-3①那套六态工作流指示器（`plan-control` 契约束的活），两者独立、互不替代（详见组件头注）。新增单测 `tests/lib/copilotkit-v2-run-progress-stage.test.tsx`（5 例，含 `TOOL_CALL_ARGS` 不误推走 stage、终态清空两条反面用例）。验证：`tsc --noEmit` 0 错误、`lint:design` 全过、`vitest run` 全量回归、`lint-spec-gate-coverage.mjs` 全绿。 |
| V4 | 待排 | V1 落地后的阅读轴回归验证，依赖 V1 先完成 |

## 四、执行入口

按 AGENTS.md 硬约束，V1-V4 逐条建 issue（`harness sync --apply`）、`worker/<owner>-<phase>-<feature>`
分支、`Closes #N` 的 PR，串行合并（composer 与 thinking 卡片都是 `copilotkit-v2-panel-body.tsx`
同一个热点文件，V1/V2 不能并行改）。四条都不需要 design-signoff（不改契约、不改数据模型、
不改后端行为），可以直接排进当前 sprint 的 `feature_list.json`。

---

*本文档基于 2026-08-30 外部 UX 评审 + 对 `origin/main` 活体代码的逐条核实整理，
不代表实现已完成——上表"结论"列是本文档写作时刻的核实结果，实现前请再次确认现状未漂移。*
