# 契约束 `agent-interrupts` — 支撑材料 `domain.md`（实体 / 值对象 / 不变量）

> 洋葱最内层，不 import 任何外层。**不在签核面里，但不许删**（`contract-design.md` §一）。
>
> **实测基线**：`origin/main` @ `d88e7693`（2026-08-26 `git fetch` 后实测）。
> 全仓 `grep -rn "confirm_intent|fill_params|choose_option"` 在
> `apps/web` / `apps/api` / `apps/deep-agent-service` / `packages` **零命中**——
> 这是纯新能力，不是整合存量。本文件下方每条「实测」引用都可复跑。

---

## 一、这是什么——三种新的 HITL 中断，不是三个新系统

三张新卡片，全部走同一条已验证可行的机制（见下「机制」一节）：

| 中断种类 | 触发源 | 一句话 |
|---|---|---|
| 目标复述卡 | `confirm_intent` | 执行前复述理解 + ≥2 条假设，未确认不执行任何工具 |
| 参数补全表单 | `fill_params` | AI 猜的字段高亮 + 依据文案，人可逐字段改 |
| 多方案对比 | `choose_option` | 2–3 张等宽卡，固定三项对照，选中即 resume |

三者的核心不变量互相依赖（都复用同一套「具名虚拟工具 + langchain 四型 decision」编码，
见下），且都不依赖 `plan-control`（六态工作流）或 `chat`（消息流）内部的不变量——
只**调用**它们的宿主关系。这正是「该独立成束」的形状（判据见 `design-signoff.md` 第一节）。

---

## 二、机制——具名虚拟工具，不是给 `interrupt()` 发明 kind 字段

### 已验证的唯一可行路径（实测，2026-08-26）

`langchain/agents/middleware/human_in_the_loop.py`
（`apps/deep-agent-service/.venv/lib/python3.14/site-packages/`）：

```python
class ActionRequest(TypedDict):
    name: str                      # 工具名——kind 藏在这里，不是独立字段
    args: dict[str, Any]
    description: NotRequired[str]

DecisionType = Literal["approve", "edit", "reject", "respond"]
```

全树只有一个 `interrupt(hitl_request)` 调用点（`:450`），`ActionRequest` **没有 kind 字段**。
`packages/contracts/src/deep-agent-hitl.ts` 已经用「单一工具名 = 单一种中断」的方式绕开了
这个限制（`DEEP_AGENT_HITL_TOOL_NAME = "call_skill"`，`DEEP_AGENT_HITL_TOOLS` 环境变量逗号
分隔多工具名，`harness.py` 的 `build_interrupt_on` 按名字解析）。**这是唯一实测可行的
「发明 kind」路径**，本束沿用它，不碰 `interrupt()` 本身。

### 三个具名虚拟工具（本束新增，不存在于全仓任何地方）

| 工具名 | kind | 初始 `args` 形状 |
|---|---|---|
| `confirm_task_intent` | `confirm_intent` | `{ understanding: str, assumptions: list[str] }` |
| `fill_run_params` | `fill_params` | `{ fields: list[ParamField] }` |
| `choose_execution_option` | `choose_option` | `{ options: list[OptionCard] }` |

`ActionRequest.name` 就是 kind 的**唯一事实源**——前端渲染哪张卡片，靠 `name` 分派，
不新建判别字段（否则「同一件事两处编码」，本仓第七次）。

### `HITLRequest`/`ActionRequest` 现有形状够不够装

**够，不需要改 langchain 库**。`args: dict[str, Any]` 是自由形状，本束的三个结构
（见下方值对象）都能塞进去；`description` 承接给人看的一句话摘要
（例如「AI 建议continue，但已识别到 2 处待确认假设」）。**唯一要新增的是本束自己的
zod schema**（`packages/contracts/src/agent-interrupts.ts`，签核③），不动
`human_in_the_loop.py`。

---

## 三、值对象

```
ParamField
  name            str            字段标识（如 "compare_baseline"）
  label           str            人看的字段名（如「对比基准」）
  aiGuess         unknown | null  AI 猜的值；null = AI 没能猜，必须人填
  rationale       str | null      猜测依据的一句话文案（如「近 6 份月报都用同比」）；
                                  aiGuess 非 null 时 rationale 不得为 null（不变量 I-3）
  required        bool           缺省时能否继续（false 允许留空，走 fill_params 的默认路径）
  currentValue    unknown | null  人已确认/编辑后的值；未决策前等于 aiGuess

OptionCard
  optionId        str            稳定 id，resume 时用它回指，不用数组下标（不变量 I-6）
  title           str
  effort          "低" | "中" | "高"                     三项固定对照之一：投入
  timeToValue     str            三项固定对照之一：见效（自由文本，如「即时」「≈2 天」）
  expectedReturn  str            三项固定对照之一：预计收益
```

⚠ **三项固定对照的字段集是封闭的**——`effort`/`timeToValue`/`expectedReturn` 三个，
不多不少（原始描述「每张固定三项对照」）。新增第四项对照维度需要走契约修订，不是本束
agent 单方面加字段。

---

## 四、实体

```
InterruptRequest
  requestId        str            = LangGraph 该次 interrupt 的稳定标识（沿用 run/step id）
  kind             "confirm_intent" | "fill_params" | "choose_option"
  toolName         str            = confirm_task_intent | fill_run_params | choose_execution_option
  args             ConfirmIntentArgs | FillParamsArgs | ChooseOptionArgs   （判别由 kind 决定）
  status           "pending" | "resolved"
  createdAt        str (ISO)
  resolvedAt       str | null
  decision         "approve" | "edit" | "reject" | null   （宿主是哪个 langchain DecisionType）
```

`InterruptRequest` **不是新表**——它是 `agent_run_steps`（`agent-runtime` 束实体）里一条
`status = "awaiting_approval"`、`toolName` 属于本束三个具名工具之一的行的**投影**，不另建
持久化面（不变量 I-9，避免「同一份状态两处存」）。

---

## 五、不变量

```
I-1  confirm_intent 未确认前，本轮不得执行任何工具调用
     （断言：graph 状态在 InterruptRequest.status = "pending" 期间，
      同一 run 的后续工具调用事件数恒为 0）

I-2  confirm_intent 的 assumptions 长度 ≥ 2
     （断言：ConfirmIntentArgs.assumptions.length >= 2，zod .min(2) 直接表达）

I-3  fill_params 里 aiGuess 非 null 的字段，rationale 必为非 null
     （断言：∀ field ∈ fields, field.aiGuess !== null ⇒ field.rationale !== null；
      违反即「有猜测无依据」，这是判据本身要求的可判定形式）

I-4  fill_params 的 currentValue 变化只重跑受影响的下游节点，
     不重跑整个 run —— ⚠ **依赖缺口，见本文件「六、依赖缺口」，本轮不承诺已具备**

I-5  choose_option 的 options 长度 ∈ [2, 3]
     （断言：ChooseOptionArgs.options.length >= 2 && <= 3，对应「2–3 张」的原始描述）

I-6  choose_option 的 resume 载荷用 optionId 回指，不用数组下标
     （断言：resume 时 editedArgs.selectedOptionId 必须 ∈ 原始 args.options[].optionId 集合，
      否则 SELECTED_OPTION_NOT_FOUND；下标寻址在选项数组因并发/重渲染而重排时会静默选错）

I-7  三种中断的 kind 与 ActionRequest.name 一一对应，且是本束对外的唯一分派依据
     （断言：前端渲染分支的 switch 只读 name，不读任何派生/猜测字段）

I-8  同一 run 同一时刻，本束三种中断最多有一个 pending
     （沿用 `agent-runtime` 束「run 恒串行执行，中断即暂停」的既有前提，
      本束不新增并发语义，只消费）

I-9  InterruptRequest 是投影，不是新表（见「四、实体」）
```

⚠ 不写「应该」「建议」——上面每条都能写成断言，写不成断言的不放进这一节。

---

## 六、依赖缺口——如实标注，不含糊

### 缺口 AI-1：「改参数只重跑受影响下游」依赖 checkpoint fork，**本仓未验证具备**

原始描述要求「改参数只重跑受影响的下游节点」。这依赖**从某个历史 checkpoint 分叉出
一条新的执行路径**（LangGraph 术语：checkpoint fork / time-travel），而不是简单的
「暂停 → 编辑 state → 从最新 checkpoint 续跑」（那只能重跑*全部*后续节点，不是
「受影响的」子集）。

**实测结论**：`agent-runtime` 束自己在 `coverage.md:249` 把这个能力标记为**缺口 25**——
`replayAgentRun`「重放一次已结束的 run」**不等于**「把线程恢复到某个 checkpoint 继续跑」，
更不等于「只重跑受影响的下游节点」（后者需要按节点粒度选择性重放，是比 checkpoint 恢复
更细的能力）。`plan-control` 束（`signoff/plan-editing`，未签核）在做类似探测时，只核实到
「取消 + 不传 checkpoint_id 的新 run」这条**全量续跑**语义（`langgraph-api==0.12.4` 实测），
同样没有核实过「选择性只重跑某几个节点」是否被 LangGraph Server REST 面暴露。

⇒ **本轮如实标注**：I-4 作为不变量写入契约，但**不作为本轮验收线索**——
`usecases.md` 的 `UC-2 fillRunParams` 会显式声明 `appliedTo: "full-rerun" | "ledger-only"`
两态而非「精确子集重跑」，把「只重跑受影响下游」降级为**已知产品期望但技术未证实**，
避免把做不到的事写进验收（`contract-design.md` 硬规则 8 的教训）。

### 缺口 AI-2：`respond` decision type 在本仓的桥接层不可达

`DecisionType` 原生四值 `approve|edit|reject|respond`，语义上 `respond`
（「人代答，工具不执行，合成一条 ToolMessage」）与 `choose_option`「选中即 resume」
的直觉最贴——但**实测**（`apps/api/src/interface/controllers/copilotkit-agui.controller.ts`
的 `parseHitlDecision`，`:279-296`）：这个桥接函数是一个**封闭三态**——

```
"approved"        → approve
"denied"          → reject
<raw JSON object> → edit（editedArgs = 该 JSON）
```

**没有第四条分支**能产出 `{type: "respond", message: ...}`；任何不落在这三态里的载荷都
`return null`（fail closed，函数自己的注释写着"Anything else is neither"）。
`respond` decision type 在 langchain 库层**不是**缺口（原生支持），
但**在本仓的桥接层是缺口**——要用它必须先改 `parseHitlDecision`（TS 源码，本轮不碰）。

⇒ **本束的设计选择：choose_option 不用 `respond`，复用现有 `edit` 分支**——
resume 时前端调 `respond(JSON.stringify({ selectedOptionId }))`
（这里 `respond` 是 CopilotKit hook 自己的回调名，与 langchain 的 `DecisionType` 同名异物，
不要混淆），桥接层已有的「raw JSON → edit」分支直接吃下这个载荷，**零桥接层代码改动**。
细节与「为什么不选 respond」的完整推导见 `usecases.md` UC-3。

### 缺口 AI-3：`ARGS_MAX_CHARS` 豁免表是按工具名等值比较的封闭清单，需要显式加行

`apps/api/src/infrastructure/agent-run/deep-agent-model-provider.ts:243-244`：

```ts
const maxChars =
  name === "write_todos" || name === DEEP_AGENT_HITL_TOOL_NAME
    ? Math.max(4000, DEEP_AGENT_HITL_ARGS_MAX_CHARS)
    : ...
```

默认截断 500 字符（`PROGRESS_SUMMARY_MAX_CHARS`），超长接 `…` 变成非法 JSON。
`fill_params` 的多字段 + 依据文案、`choose_option` 的 2-3 张选项卡三项对照，都**大概率
超过 500 字符**——与 `deep-agent-hitl.ts` 文件头注释描述的"call_skill 的 task 字段"同一
形态的坑。**这是一个封闭清单，不是策略**，新增三个工具名必须逐一加行，不能整类放行
（与 `PLUMBING_CUSTOM_EVENT_NAMES` 同一纪律）。落地在实现期第一件事，登记于 `coverage.md`。

---

## 七、跨语言边界——同上一先例，靠门控不靠 import

`confirm_task_intent` / `fill_run_params` / `choose_execution_option` 三个工具本体要在
`apps/deep-agent-service`（Python）侧用 `@tool` 定义，TypeScript 侧的
`packages/contracts/src/agent-interrupts.ts` 无法 import 它们。跨语言边界必须靠
`tests/agent-interrupts.test.ts` 直接读 `.py` 源码断言函数名与参数名逐字一致来守
（复刻 `deep-agent-hitl.test.ts` 的既有模式），**不是本轮产出**，登记在 `coverage.md`
供实现期第一件事去建。
