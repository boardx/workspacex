# 契约束 `agent-interrupts` — ② 用例接口与失败模式（签核面第 ② 件）

> 洋葱中层，只依赖 `domain.md`。回答「application 层的端口长什么样，失败长什么样」。
> 束↔feature 映射的权威在 `design-signoff.md` 的 frontmatter `covers:`（本轮为空，
> 见该文件说明）。

## 统一约定

- 调用者身份来自 `CurrentPrincipal()`，不由入参传递。
- 可见性与写权判定**全部委托** `chat` 束 UC-0（本束不重复定义角色语义）。
- 三个 UC 都是**内部端口**（无独立 HTTP 面）——它们是 langgraph `interrupt()` /
  `resume` 语义在 application 层的投影，真正的对外 HTTP 面是既有的
  `POST /copilotkit`（AG-UI 桥，`chat`/`agent-runtime` 束已有），本束不新开路由。
- 三个 UC 共享的失败枚举见下。

## 统一失败枚举 `AgentInterruptError`

```
NOT_VISIBLE                    调用者对该线程无可见权（委托 chat UC-0）
NO_WRITE_ROLE                  可见但无写权，决策接口拒绝（观察者恒无写权）
NO_ACTIVE_INTERRUPT            该线程当前没有本束任一 kind 的 pending 中断
INTERRUPT_KIND_MISMATCH        decision 载荷的隐含 kind 与当前 pending 中断的 kind 不符
                                （例如对 confirm_intent 中断发 choose_option 形状的载荷）
STALE_INTERRUPT                该中断已被另一决策解决（并发，双开两个标签页各点一次）
MALFORMED_RESUME_PAYLOAD       resume 载荷既不是已知字面量也不是合法 JSON
                                （对应 domain.md 缺口 AI-2 描述的 parseHitlDecision fail-closed 路径）
SELECTED_OPTION_NOT_FOUND      choose_option 的 selectedOptionId 不在原始 options 集合里（I-6）
AUDIT_SINK_UNAVAILABLE         决策写不进审计 ⇒ 整个 resume 失败（fail closed，
                                与 agent-runtime 束 ProvenanceWriter 同纪律）
```

---

# UC-1 `confirmTaskIntent` —— 目标复述卡

```
触发: ActionRequest.name === "confirm_task_intent"
in:  { requestId, understanding: str, assumptions: list[str] }   # AI 产出，只读展示
out（continue 分支）:
     { decision: "approve" }
out（改假设分支）:
     { decision: "edit", editedArgs: { assumptions: list[str] } }
pre: 调用者对该线程有写权（委托 chat UC-0）；该 requestId 当前 kind = confirm_intent 且 pending
err: NOT_VISIBLE | NO_WRITE_ROLE | NO_ACTIVE_INTERRUPT | INTERRUPT_KIND_MISMATCH
   | STALE_INTERRUPT | AUDIT_SINK_UNAVAILABLE
```

### 反证——「未确认前不执行任何工具」怎么变成可判定的

不写成一句话断言，写成可复跑的机制事实：

- **正向**：`confirm_task_intent` 是 `DEEP_AGENT_HITL_TOOLS` 白名单里的一个具名工具
  （`domain.md` 二节），graph 在调用它时**必然** `interrupt()`，langgraph 的执行语义是
  该节点之后的图**不会继续 tick**，直到 resume 收到合法 `Decision`。
  ⇒ 断言点：`agent_run_steps` 表里，`toolName = "confirm_task_intent"` 且
  `status = "awaiting_approval"` 的行之后，**同一 `runId` 不存在任何
  `createdAt` 更晚、且 `status != "awaiting_approval"` 的工具调用行**（查询即断言，
  不依赖计时器/sleep）。
- **反向**（防止「确认门总是不出现」把反证变成空转）：至少一条 e2e 用例要构造一个
  **真的触发 confirm_intent 的任务**（依赖 Python 侧 prompt/graph 逻辑何时调用
  `confirm_task_intent`，**不在本束契约内**——本束只保证「一旦调用，未确认不往下走」，
  不保证「AI 什么时候决定调用它」，后者是 skill/prompt 工程的职责，登记在
  `coverage.md` 的边界声明里）。

### 「改假设」分支的落地

`editedArgs.assumptions` 是**人编辑后的完整列表**（不是 diff）；resume 后
graph 收到 `EditDecision{edited_action: {name: "confirm_task_intent", args: {assumptions: [...]}}}`，
langchain 中间件会**用编辑后的 args 重新调用该工具**（这是 `edit` decision 的标准语义，
不是本束发明）——即「改假设」本质是「用新假设重新确认一次」，不是打开第二轮 UI 流程。

---

# UC-2 `fillRunParams` —— 参数补全表单

```
触发: ActionRequest.name === "fill_run_params"
in:  { requestId, fields: list[ParamField] }        # 见 domain.md「三、值对象」
out（接受全部 AI 猜测）:
     { decision: "approve" }
out（改动任意字段）:
     { decision: "edit", editedArgs: { fields: list[{ name, value }] }, appliedTo }
appliedTo: "full-rerun" | "ledger-only"        # ⚠ 不是「精确子集重跑」，见 domain.md 缺口 AI-1
pre: 调用者对该线程有写权；该 requestId 当前 kind = fill_params 且 pending
err: NOT_VISIBLE | NO_WRITE_ROLE | NO_ACTIVE_INTERRUPT | INTERRUPT_KIND_MISMATCH
   | STALE_INTERRUPT | AUDIT_SINK_UNAVAILABLE
   | PLAN_CONSTRAINT_BLANK†  （必填字段留空且 required=true 时；† 复用 plan-control 同名码的语义，
                                若 plan-control 未签核前实现本束，改用等价的 FIELD_REQUIRED_BLANK）
```

⚠ **`err` 里的 `PLAN_CONSTRAINT_BLANK` 是占位提醒，不是最终码**——它标出「本束错误码
是否要与 `plan-control`（同样在 `pending`）对齐同一套必填校验语义」这件事需要在两束
都签核后的阶段一致性复核里核，不在本束单方面定。最终码见签核时的裁决，草案先用
`FIELD_REQUIRED_BLANK`。

### 「只重跑受影响下游」如实降级

`appliedTo: "full-rerun"` 是**本轮唯一实测可落地**的路径：编辑后的 `fields` 写回 state，
下一次 run（或续跑）从最近 checkpoint 开始**全量**执行后续图，不是只跑受影响的节点。
`appliedTo: "ledger-only"` 复用 `plan-control` 束已验证的「run 活跃时只落账本，
下一轮送达」范式（`plan-control/usecases.md` I-11 同构）——两束都遇到「run 执行中改参数
不可靠」这同一个坑，**处置方式故意同构**，登记为跨束一致性检查项（见 `coverage.md`）。

### AI 猜测的展示纪律（对应「AI 猜的字段单独高亮」）

`ParamField.aiGuess !== null` 的字段，前端**必须**渲染 `rationale`（不变量 I-3 已经在
契约层强制了「有猜测必有依据」）；`aiGuess === null` 的字段视觉上不带高亮，因为没有
「AI 猜测」这件事可高亮——它是纯人工必填项。

---

# UC-3 `chooseExecutionOption` —— 多方案对比

```
触发: ActionRequest.name === "choose_execution_option"
in:  { requestId, options: list[OptionCard] }       # 2–3 项，见 domain.md I-5
out: { decision: "edit", editedArgs: { selectedOptionId: str } }
pre: 调用者对该线程有写权；该 requestId 当前 kind = choose_option 且 pending
err: NOT_VISIBLE | NO_WRITE_ROLE | NO_ACTIVE_INTERRUPT | INTERRUPT_KIND_MISMATCH
   | STALE_INTERRUPT | SELECTED_OPTION_NOT_FOUND | AUDIT_SINK_UNAVAILABLE
```

### 🔴 为什么不用 `approve`/`reject`/`respond`——三个都过一遍，逐条排除

这是「choose_option 怎么在现有四种 decision 类型上表达」的完整推导，**不是我代选**，
结论已经落进上面的 `out`，但排除过程必须留痕：

| decision | 排除理由 |
|---|---|
| `approve` | 语义是「按原样执行这次工具调用」——但 `choose_execution_option` 的原始 `args` 是**整个菜单**（2-3 个选项），没有默认可执行的单一动作。approve 会让工具带着「全部选项」的 args 执行，产出无意义。 |
| `reject` | 语义是「拒绝这次调用，不执行」——**可以**作为「都不要，取消」的逃生口保留（见下 allowedDecisions），但不能表达「选中了哪一个」。 |
| `respond` | 语义上最贴（人代答，工具不执行），且 langchain 库层**原生支持**——但 `domain.md` 缺口 AI-2 实测确认：本仓桥接层 `parseHitlDecision` 是一个**封闭三态**，没有产出 `{type:"respond"}` 的分支。要用它必须先改 `apps/api/src/interface/controllers/copilotkit-agui.controller.ts`（TS 源码），这轮契约不碰实现代码。 |
| **`edit`（选定）** | 桥接层**已经支持**「resume 载荷是一个 JSON 对象 ⇒ 解析成 `editedArgs`」这条路径（`parseHitlDecision:287-291`，供 `call_skill` 的改参数场景使用）。让前端调 `respond(JSON.stringify({ selectedOptionId }))`（这里 `respond` 是 CopilotKit hook 自己的回调名，见 domain.md 缺口 AI-2 的辨析），桥接层原样吃下——**零桥接层代码改动**。语义上把「选择」建模成「把 args 编辑成只剩选中项的引用」，与 langchain `EditDecision` 的字面定义（"edited_action for the agent to perform"）不冲突：编辑后的调用就是"以选中的方案执行"。 |

⇒ **结论：不是「现有四型缺一个『多选一』语义」，是「`respond` 那个最贴切的语义在
本仓桥接层不可达；`edit` 语义上够用且零改动」**——这与需求方案原始描述里预设的
"可能需要扩展 decision 类型（触碰 langchain 库本身）"不同：**不需要扩展库**，
需要的是一条设计约定（args 变形）+ 对 `parseHitlDecision` 现状的准确认识。

### `allowedDecisions` 声明（`ReviewConfig.allowed_decisions`）

`choose_execution_option` 的 `ReviewConfig.allowed_decisions = ["edit", "reject"]`
（不含 `approve`/`respond`，理由见上表）。`reject` 对应「都不要」——UI 上是否画出这个
入口是 `ui.md` 的决定，本束只保证契约允许它。

### 后续流式文案随选择改变

选中 resume 后，langchain 中间件用 `editedArgs`（`{selectedOptionId}`）重新调用
`choose_execution_option`；该工具的 Python 实现（不在本轮范围）读到 `selectedOptionId`
后应返回对应方案的执行计划文本，驱动下游节点按选中方案生成后续消息——这条「文案随选择
改变」的因果链条本束只声明**入口契约**（工具返回值影响后续 prompt 装配），不声明后续
prompt 措辞本身（那是 skill/prompt 工程职责）。

---

## 与 `plan-control` 束的关系——消费，不重复定义

`plan-control` 束（`pending`，`signoff/plan-editing`）的六态工作流里有「审批」态。
本束三种中断**都可能在「计划」态或「执行」态触发**（例如执行到某一步发现参数不全 ⇒
`fill_params`），不专属于 plan-control 的「审批」态——「审批」态在 TW-P0-6 判据下指的是
**风险分级的高影响动作批准**（approve/edit/reject 三态，`call_skill` 已用的那条路径），
与本束三种中断是**同一机制的不同工具名实例**，不是两套系统。UC 层面本束不引用
plan-control 的任何端口，仅在 `coverage.md` 里登记这条「appliedTo 语义故意同构」的
交叉关系供一致性复核使用。
