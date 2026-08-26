# 契约束 `agent-interrupts` — 支撑材料 `coverage.md`（UC 覆盖证明）

> 横切材料，双向检查。**不在签核面里，但不许删**（`contract-design.md` §一）。
> `design-signoff.md` frontmatter `covers: [F212, F213, F214, F215, F216]` 已回填
> （2026-08-26）——本文件的映射表随之补上 `feature` 落点。

## 〇、UC 验收线索映射表（F212 契约内核落点 + 门控命令）

| 行键 | UC 验收线索 | API 操作 / 门控命令 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | UC-1 `confirmTaskIntent`：目标复述卡 in/out 形状（`ConfirmIntentArgs`/`ConfirmIntentDecision`）+ 不变量 I-2（assumptions ≥2） | `packages/contracts/src/agent-interrupts.ts`（`ConfirmIntentArgs`/`ConfirmIntentDecision`）；`pnpm --filter @repo/contracts exec vitest run tests/agent-interrupts.test.ts` | F213（前端卡片，未开工） | ✅ 契约已落地，前端待 F213 |
| V2 | UC-1 反证：未确认前不执行任何工具（I-1） | 契约层不产出该断言（需要真实 run 数据）——e2e 断言点见 `usecases.md` UC-1 反证节（`agent_run_steps` 查询即断言） | F213/F216（HITL 决策守卫，未开工） | ⚠ **缺口**：本轮只出契约类型，运行时反证留给 F216（`usecases.md` 已给出可复跑的查询形式，非本轮遗漏） |
| V3 | UC-2 `fillRunParams`：`FillParamsArgs`/`ParamField` + 不变量 I-3（aiGuess 非 null ⇒ rationale 非 null，`.refine` 已表达） | `packages/contracts/src/agent-interrupts.ts`（`FillParamsArgs`/`ParamField`）；同上 vitest 命令 | F214（前端表单，未开工） | ✅ |
| V4 | UC-2 `appliedTo` 两态降级（design-signoff §六 决策①：知情降级） | `packages/contracts/src/agent-interrupts.ts`（`FillParamsAppliedTo`/`FillParamsDecision`） | F214 | ✅ 契约已如实标注两态，非「精确子集重跑」 |
| V5 | UC-3 `chooseExecutionOption`：`ChooseOptionArgs`/`OptionCard` + 不变量 I-5（2–3 项）I-6（optionId 回指） | `packages/contracts/src/agent-interrupts.ts`（`ChooseOptionArgs`/`OptionCard`） | F215（前端对比卡，未开工） | ✅ |
| V6 | UC-3 decision 选 `edit`（design-signoff §六 决策②），`allowedDecisions=["edit","reject"]` | `packages/contracts/src/agent-interrupts.ts`（`ChooseOptionDecision`/`CHOOSE_OPTION_ALLOWED_DECISIONS`） | F215 | ✅ 零桥接层改动，`apps/api` 侧 `parseHitlDecision` 未碰 |
| V7 | 统一失败枚举 `AgentInterruptError`（8 码 + 占位码） | `packages/contracts/src/agent-interrupts.ts`（`AgentInterruptError`） | F213/F214/F215 各自错误态 UI（未开工） | ⚠ `FIELD_REQUIRED_BLANK` 待与 `plan-control` 一致性复核裁定正式码（AI-6，非本轮阻塞） |
| V8 | 跨语言边界：三个工具名是否需要 Python `@tool` 真实存在 | `pnpm --filter @repo/contracts exec vitest run tests/agent-interrupts.test.ts`（如实断言现状 + 环境变量投影链条） | —（无前端消费点，工程门控） | ⚠ **缺口 AI-4b**（新增，见下表）：Python 侧 `@tool` 未落地，已确认为独立 feature，本轮只做「如实反向锚点」 |
| V9 | `ARGS_MAX_CHARS` 豁免清单加三个工具名（AI-3） | `apps/api/src/infrastructure/agent-run/deep-agent-model-provider.ts`；同 vitest 命令覆盖常量导出 | —（API 层验收，事件流不截断） | ✅ 本轮已加行 |
| V10 | `DEEP_AGENT_HITL_TOOLS` 环境变量投影扩容（AI-5） | `.harness/scripts/vm/provision.sh` 静态值 + `packages/contracts/tests/deep-agent-hitl.test.ts` 断言更新 | —（部署配置，无前端消费点） | ✅ 本轮已扩容，惰性安全（见 `agent-interrupts.ts` 文件头） |

**两个方向都要查**：
- **UC → API**：V1/V3/V5/V6/V7 均落在本文件已建的 `agent-interrupts.ts`；V2 的运行时反证留给 F216（不是本轮遗漏，是分批交付）。
- **API → UC**：`agent-interrupts.ts` 的每个 export 都能追回上表某一行，无孤儿导出。

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
| AI-3 | `ARGS_MAX_CHARS` 豁免表是封闭清单，需逐一加行 | ✅ 本轮（F212）已做 | `deep-agent-model-provider.ts` 豁免条件加 `AGENT_INTERRUPTS_TOOL_NAME_LIST.includes(name)`；`agent-interrupts.ts` 导出 `AGENT_INTERRUPTS_ARGS_MAX_CHARS` |
| AI-4 | 跨语言边界（Python 工具定义 vs TS 契约）无门控测试 | ✅ 本轮（F212）已建，但内容随 AI-4b 现状调整 | `packages/contracts/tests/agent-interrupts.test.ts`——环境变量投影链条 + ARGS_MAX_CHARS + **如实断言三个工具名此刻在 `tools.py` 里还不存在**（反向锚点，见 AI-4b） |
| AI-4b | **新增（F212 实现期实测发现）**：三个工具名要真正触发 `interrupt()`，必须在 Python 侧 `tools.py` 有对应 `@tool` 函数并被 `build_tools()` 注册——**实测确认不是纯前端约定**（`harness.py` `build_interrupt_on` 只是按工具名开中断开关，模型只能调用真实注册的工具） | 🔴 **超出本轮范围，已登记后续 feature** | Python 侧新增三个 `@tool` 函数（`confirm_task_intent`/`fill_run_params`/`choose_execution_option`），需要新 feature（不在 F212-F216 范围内，登记为后续任务） |
| AI-5 | `DEEP_AGENT_HITL_TOOLS` 环境变量投影需要扩容 | ✅ 本轮（F212）已做，惰性安全 | `provision.sh` 静态值改为 `call_skill,confirm_task_intent,fill_run_params,choose_execution_option`；`deploy.sh` 白名单本身无需改（`DEEP_AGENT_HITL_TOOLS` 键已在其中，只是值变化）；`deep-agent-hitl.test.ts` 对应断言同步更新。⚠ 惰性安全的理由见 `agent-interrupts.ts` 文件头：`interrupt_on` 不校验键是否对应已注册工具，AI-4b 落地前这三个名字永远不会被调用 |
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
