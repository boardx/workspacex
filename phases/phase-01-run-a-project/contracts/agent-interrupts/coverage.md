# 契约束 `agent-interrupts` — 支撑材料 `coverage.md`（UC 覆盖证明）

> 横切材料，双向检查。**不在签核面里，但不许删**（`contract-design.md` §一）。
> ⚠ 本束尚无 `feature_list.json` 条目（`design-signoff.md` frontmatter `covers: []`），
> 因此下表不是「UC → feature」而是「原始需求描述 → UC → API 操作 → 前端消费点」——
> feature 编号由 `requirement-author` 在签核后生成，届时本文件需要补一栏 `feature`。

## 〇、R12 映射表（签核第 ③ 件的落点，`packages/contracts/src/agent-interrupts.ts`）

| V | 一句话 | API 操作 | 前端消费点 | feature |
|---|---|---|---|---|
| V1 | 目标复述卡：理解 + ≥2 条假设，未确认不执行任何工具 | `confirmTaskIntent`（`AgentInterruptKind.confirm_intent`，`operations.confirmTaskIntent`，内部端口，宿主 `POST /copilotkit`） | `agent-interrupt-confirm-intent-*` | F213 |
| V2 | 参数补全表单：AI 猜测字段高亮 + 依据，逐字段可改 | `fillRunParams`（`operations.fillRunParams`） | `agent-interrupt-fill-params-*` | F214 |
| V2a | 改动只重跑受影响下游 | `fillRunParams.out.appliedTo` | 同上 | F214 |⚠ **缺口 AI-1**（依赖 checkpoint fork 未证实，降级为 full-rerun/ledger-only 两态，见第一节）
| V3 | 多方案对比：2–3 张等宽卡，固定三项对照，选中即 resume | `chooseExecutionOption`（`operations.chooseExecutionOption`） | `agent-interrupt-choose-option-*` | F215 |
| V4 | 中断决策统一守卫（8 错误码 fail-closed） | `AgentInterruptError`（`packages/contracts/src/agent-interrupts.ts`，9 值：8 码 + 占位码 `FIELD_REQUIRED_BLANK`，见五、审计与错误语义跨束一致性） | —（API 层验收：`pnpm --filter api exec vitest run tests/agent-interrupts/decision-guard-errors.test.ts`） | F216 |
| V5 | 跨语言边界：Python `@tool` 与 TS 契约逐字一致 | `AGENT_INTERRUPT_TOOL_NAMES` 常量表 | —（门控层验收：`pnpm --filter @repo/contracts exec vitest run tests/agent-interrupts/cross-lang-tool-parity.test.ts`） | F212 |⚠ **缺口 AI-4**（该测试本轮未产出，见第三节，登记为实现期第一件事）

反向覆盖：本束不新开 HTTP 路由（`usecases.md` 顶部已声明），三个具名虚拟工具与三个 `operations` 端口一一对应，无孤儿（见第二节既有的正向表）。

---

## 一、原始需求 → UC（正向：需求是否都有落点）

| 原始需求描述 | UC | 状态 |
|---|---|---|
| 目标复述卡：理解 + ≥2 条假设 | UC-1 `confirmTaskIntent` | ✅ |
| 「继续」resume | UC-1 approve 分支 | ✅ |
| 「改假设」把假设变可编辑字段后 resume | UC-1 edit 分支 | ✅ |
| 未确认前不执行任何工具 | UC-1 反证节（不变量 I-1） | ✅ 已给出可复跑断言点 |
| 参数补全表单：AI 猜测字段高亮 + 依据 | UC-2 `fillRunParams` + `domain.md` I-3 | ✅ |
| 改参数只重跑受影响下游节点 | UC-2 `appliedTo` | ⚠ **缺口 AI-1**：技术未证实，降级为 full-rerun/ledger-only 两态 |
| 多方案对比：2–3 张等宽卡，三项固定对照 | UC-3 `chooseExecutionOption` + `domain.md` I-5 | ✅ |
| 选中即 resume | UC-3 out（`edit` 分支） | ✅ |
| 后续流式文案随选择改变 | UC-3 末节 | ⚠ 本束只声明入口契约，措辞本身不在范围内（登记非缺口，是边界声明） |

## 二、API 操作 → UC（反向：有没有多余操作）

本束**没有独立 HTTP 面**（`usecases.md` 顶部已声明），三个 UC 都是既有
`POST /copilotkit` AG-UI 桥的内部投影。⇒ 反向检查的对象是**三个具名虚拟工具**，
而非 REST 操作：

| 具名工具 | 被哪个 UC 要求 | 多余吗 |
|---|---|---|
| `confirm_task_intent` | UC-1 | 否 |
| `fill_run_params` | UC-2 | 否 |
| `choose_execution_option` | UC-3 | 否 |

三个工具各自恰好对应一个 UC，无孤儿。

## 三、依赖缺口清单（`domain.md` 已定义，此处仅索引 + 实现期待办）

| 编号 | 内容 | 严重度 | 实现期第一件事 |
|---|---|---|---|
| AI-1 | 「只重跑受影响下游」依赖 checkpoint fork，未证实 | 🟠 产品期望降级 | 若要恢复该能力，先探测 LangGraph Server REST 面是否支持节点粒度选择性重放（`agent-runtime` 缺口 25 的延伸调查，不在本束单方面做） |
| AI-2 | `respond` decision 在桥接层 `parseHitlDecision` 不可达 | 🟢 已绕开，非阻塞 | 无需动作（设计已选 `edit` 路径） |
| AI-3 | `ARGS_MAX_CHARS` 豁免表是封闭清单，需逐一加行 | 🟡 实现期必做，否则真实长任务下 JSON 截断 | `deep-agent-model-provider.ts:243-244` 加三个工具名；`deep-agent-hitl.ts` 或新文件导出对应 `*_ARGS_MAX_CHARS` 常量 |
| AI-4 | 跨语言边界（Python 工具定义 vs TS 契约）无门控测试 | 🟡 实现期必做 | 仿 `deep-agent-hitl.test.ts`，新建 `agent-interrupts.test.ts` 逐字比对三个 `@tool` 函数签名 |
| AI-5 | `DEEP_AGENT_HITL_TOOLS` 环境变量与 `deploy.sh` 投影白名单需要扩容 | 🟡 实现期必做 | `deep-agent.env` 的该键改为四工具逗号分隔；确认 `deploy_project_capability_env` 白名单已含新键（大概率不需要改白名单本身，只改值） |
| AI-6 | `fill_params`/`plan-control` 的 `appliedTo` 错误码是否共用 | 🟠 待两束一致性复核 | `usecases.md` UC-2 已用占位码 `FIELD_REQUIRED_BLANK`，正式码留给一致性复核裁决 |

## 四、CUSTOM/STATE 事件名——结论：不新增

三种中断复用既有 `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` /
`TOOL_CALL_RESULT` 四件套（`copilotkit-agui.controller.ts` 的 `writeToolCallStep`
既有生产者），resume 走既有的「最后一条消息 role=tool」判定（`isHitlResumeRequest`）+
`parseHitlDecision` 的既有三态解析（`edit` 分支承接本束全部三种中断的「有改动」场景，
`approve`/`reject` 复用既有字面量分支）。

⇒ **`PLUMBING_CUSTOM_EVENT_NAMES` 本轮不需要新增条目**——这正是反证门要求的「不许放行
整类」的反面验证：先查过实际需要，结论是不需要，而不是默认不需要就不查。

若实现期发现三种中断的 args 体量（尤其 `fill_params` 多字段 + `choose_option` 三张卡）
在既有四件套上表达不下（例如需要结构化增量更新而非一次性全量 args），**新增事件名
必须走「具名条目 + 真实生产者 + 新反证」三件齐**的既有纪律
（`agui-bridge-state-events.test.ts:70-71`），不得放行整类；届时候选名与登记方式在
本节补充，非本轮预判范围。

## 五、审计与错误语义跨束一致性（供阶段一致性复核）

| 本束码 | 与哪个已签束同码同义 | 核对状态 |
|---|---|---|
| `NOT_VISIBLE` | `chat.ts` 已有同名同义 | ✅ 沿用 |
| `NO_WRITE_ROLE` | `chat.ts` 已有同名同义 | ✅ 沿用 |
| `AUDIT_SINK_UNAVAILABLE` | `chat.ts` / `agent-runtime` 已有同名同义 | ✅ 沿用 |
| `FIELD_REQUIRED_BLANK`（占位） | 与 `plan-control.PlanControlError.PLAN_CONSTRAINT_BLANK` 语义相邻但非同码 | ⚠ 待两束都签核后统一裁决（AI-6） |
