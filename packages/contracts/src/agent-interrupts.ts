/**
 * 契约束 `agent-interrupts` —— 签核③（API 契约）落点。issue F212。
 *
 * 设计签核见 `phases/phase-01-run-a-project/contracts/agent-interrupts/design-signoff.md`
 * （`status: confirmed`，2026-08-26）。本文件是那份签核 §四「③ API 契约」承诺的
 * `packages/contracts/src/agent-interrupts.ts`——把已批准的设计翻译成代码，不重新设计。
 *
 * ## 这是什么
 *
 * 三种新的 HITL 中断（目标复述卡 / 参数补全表单 / 多方案对比）的 zod 单一事实源。
 * 沿用 `deep-agent-hitl.ts` 已验证可行的机制：**具名虚拟工具 = kind 编码方式**
 * （`ActionRequest.name` 就是 kind 的唯一事实源，langchain 的 `interrupt()` 本身没有
 * kind 字段，见 `domain.md` 二节）。本文件与 `deep-agent-hitl.ts` 是**平行**关系
 * （design-signoff §六 决策④：新文件，不改 `deep-agent-hitl.ts` 现有单工具名形状）。
 *
 * ## 三个具名虚拟工具
 *
 * | 工具名 | kind | 宿主 UC |
 * |---|---|---|
 * | `confirm_task_intent` | `confirm_intent` | UC-1 `confirmTaskIntent` |
 * | `fill_run_params` | `fill_params` | UC-2 `fillRunParams` |
 * | `choose_execution_option` | `choose_option` | UC-3 `chooseExecutionOption` |
 *
 * ## Python 侧 `@tool` 实现现状（issue #2252，已落地）
 *
 * 三个工具名要真正触发 `interrupt()`，**必须**在 Python 侧（`apps/deep-agent-service`）
 * 存在对应的 `@tool` 函数，并被 `tools.py` 的 `build_tools()` 注册进 `graph.py` 传给
 * `create_deep_agent(tools=..., interrupt_on=build_interrupt_on())` 的 `tools` 列表——
 * 这一点在本文件最初写下时（F212）尚未成立，已由 #2252 补上：`tools.py` 现在真实定义
 * `confirm_task_intent`/`fill_run_params`/`choose_execution_option` 三个 `@tool` 函数
 * 并注册进 `build_tools()`，`graph.py` 的 `SYSTEM_PROMPT` 也补了这三个工具各自的触发
 * 时机说明（同 `write_todos` 的 #2224 先例）。
 *
 * ⚠ Python 侧函数签名**不是**逐字等于下面的 `*Args` 契约形状：`HumanInTheLoopMiddleware`
 * 的 `edit` 决策会用各自 `*Decision.editedArgs`（比初始调用参数更窄的形状，例如
 * `ChooseOptionDecision.editedArgs` 只有 `selectedOptionId`，没有 `requestId`/`options`）
 * 重新调用**同一个** Python 函数，所以每个参数在 Python 侧都是可选的，函数体按"哪些
 * 字段实际有值"区分是 approve 路径（原始完整参数）还是 edit 路径（精简后的参数）。
 * 详见 `apps/deep-agent-service/src/deep_agent_service/tools.py` 该段落的模块注释。
 *
 * ## 跨语言边界门控
 *
 * `packages/contracts/tests/agent-interrupts/cross-lang-tool-parity.test.ts` 直接读
 * `tools.py` 源码，断言：① 三个 `@tool` 函数真实存在；② 每个函数的 Python 参数集合
 * 等于"契约 `*Args` 字段 ∪ 该工具已知的 `editedArgs` 字段"这个并集（不是逐字相等，
 * 理由见上一节）——契约字段一个都不能在 Python 侧丢失，Python 侧也不能有找不到出处
 * 的多余参数。与 `deep-agent-hitl.test.ts` 对 `call_skill` 的逐字比对是同一纪律在
 * "存在多种恢复形状"这个额外约束下的对应形式，不是放松。
 */
import { z } from "zod";

/* ── 一、三个具名虚拟工具名 ──────────────────────────────────────────── */

/**
 * `ActionRequest.name` 的唯一事实源。前端渲染哪张卡片、Python 侧要注册哪个 `@tool`
 * 函数名，都从这里取，不在别处再写一遍字面量（不变量 I-7）。
 */
export const AGENT_INTERRUPTS_TOOL_NAMES = {
  confirmTaskIntent: "confirm_task_intent",
  fillRunParams: "fill_run_params",
  chooseExecutionOption: "choose_execution_option",
} as const;

/** kind ↔ 工具名的判别集合，逐字对应 `domain.md` 四节 `InterruptRequest.kind`。 */
export const AgentInterruptKind = z.enum(["confirm_intent", "fill_params", "choose_option"]);
export type AgentInterruptKind = z.infer<typeof AgentInterruptKind>;

/** kind → 工具名的映射，`InterruptRequest.toolName` 由此派生，不许两处手写。 */
export const AGENT_INTERRUPT_KIND_TO_TOOL_NAME: Record<AgentInterruptKind, string> = {
  confirm_intent: AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent,
  fill_params: AGENT_INTERRUPTS_TOOL_NAMES.fillRunParams,
  choose_option: AGENT_INTERRUPTS_TOOL_NAMES.chooseExecutionOption,
};

/* ── 二、值对象（domain.md 三节）────────────────────────────────────── */

/**
 * `ParamField`——不变量 I-3：`aiGuess` 非 null 时 `rationale` 不得为 null
 * （「有猜测无依据」在契约层直接被拒绝，不留到运行时才发现）。
 */
export const ParamField = z
  .object({
    name: z.string().min(1),
    label: z.string().min(1),
    aiGuess: z.unknown().nullable(),
    rationale: z.string().nullable(),
    required: z.boolean(),
    currentValue: z.unknown().nullable(),
  })
  .refine((f) => f.aiGuess === null || f.rationale !== null, {
    message: "aiGuess 非 null 时 rationale 不得为 null（不变量 I-3：有猜测必有依据）",
    path: ["rationale"],
  });
export type ParamField = z.infer<typeof ParamField>;

/**
 * `OptionCard`——三项固定对照字段集是封闭的（`domain.md` 三节 ⚠ 段），
 * `effort`/`timeToValue`/`expectedReturn` 不多不少，新增第四项需要走契约修订。
 */
export const OptionCard = z.object({
  optionId: z.string().min(1),
  title: z.string().min(1),
  effort: z.enum(["低", "中", "高"]),
  timeToValue: z.string().min(1),
  expectedReturn: z.string().min(1),
});
export type OptionCard = z.infer<typeof OptionCard>;

/* ── 三、UC-1 confirmTaskIntent —— 目标复述卡 ────────────────────────── */

/** 触发工具 `confirm_task_intent` 的初始 args。不变量 I-2：assumptions 可为空，仅列真实假设。 */
export const ConfirmIntentArgs = z.object({
  requestId: z.string().min(1),
  understanding: z.string().min(1),
  assumptions: z.array(z.string().min(1)),
});
export type ConfirmIntentArgs = z.infer<typeof ConfirmIntentArgs>;

/** UC-1 `out`：continue 分支（approve）与「改假设」分支（edit）二选一。 */
export const ConfirmIntentDecision = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }),
  z.object({
    decision: z.literal("edit"),
    editedArgs: z.object({ assumptions: z.array(z.string().min(1)) }),
  }),
]);
export type ConfirmIntentDecision = z.infer<typeof ConfirmIntentDecision>;

/* ── 四、UC-2 fillRunParams —— 参数补全表单 ──────────────────────────── */

/** 触发工具 `fill_run_params` 的初始 args。 */
export const FillParamsArgs = z.object({
  requestId: z.string().min(1),
  fields: z.array(ParamField),
});
export type FillParamsArgs = z.infer<typeof FillParamsArgs>;

/**
 * `appliedTo`——design-signoff §六 决策①（人类裁决 A）：知情降级，先做两态，
 * **不是**「精确子集重跑」。`full-rerun` = 从最近 checkpoint 全量续跑后续图；
 * `ledger-only` = 复用 `plan-control` I-11 同构范式，run 活跃时只落账本、下一轮送达。
 */
export const FillParamsAppliedTo = z.enum(["full-rerun", "ledger-only"]);
export type FillParamsAppliedTo = z.infer<typeof FillParamsAppliedTo>;

/** UC-2 `out`：接受全部 AI 猜测（approve）或改动任意字段（edit + appliedTo）。 */
export const FillParamsDecision = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }),
  z.object({
    decision: z.literal("edit"),
    editedArgs: z.object({
      fields: z.array(z.object({ name: z.string().min(1), value: z.unknown() })),
    }),
    appliedTo: FillParamsAppliedTo,
  }),
]);
export type FillParamsDecision = z.infer<typeof FillParamsDecision>;

/* ── 五、UC-3 chooseExecutionOption —— 多方案对比 ────────────────────── */

/** 触发工具 `choose_execution_option` 的初始 args。不变量 I-5：options 2–3 项。 */
export const ChooseOptionArgs = z.object({
  requestId: z.string().min(1),
  options: z.array(OptionCard).min(2).max(3),
});
export type ChooseOptionArgs = z.infer<typeof ChooseOptionArgs>;

/**
 * UC-3 `out`——design-signoff §六 决策②（人类裁决 A）：走 `edit`，**不**碰桥接层。
 * 前端以 `respond(JSON.stringify({ selectedOptionId }))` resume（`respond` 是 CopilotKit
 * hook 自己的回调名，与 langchain `DecisionType` 同名异物，见 `domain.md` 缺口 AI-2），
 * 桥接层既有的「raw JSON → edit」分支原样吃下，零改动。`reject` 作为「都不要」的逃生口
 * 保留（`ReviewConfig.allowed_decisions = ["edit", "reject"]`，不含 `approve`/`respond`）。
 */
export const ChooseOptionDecision = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("edit"),
    editedArgs: z.object({ selectedOptionId: z.string().min(1) }),
  }),
  z.object({ decision: z.literal("reject") }),
]);
export type ChooseOptionDecision = z.infer<typeof ChooseOptionDecision>;

/** `choose_execution_option` 允许的 decision 类型集合，供实现期直接引用，不手写字面量。 */
export const CHOOSE_OPTION_ALLOWED_DECISIONS = ["edit", "reject"] as const;

/* ── 六、统一失败枚举（usecases.md 顶部）─────────────────────────────── */

/**
 * `FIELD_REQUIRED_BLANK` 是占位码（`usecases.md` UC-2 err 段落已标注）：
 * 是否与 `plan-control.PLAN_CONSTRAINT_BLANK` 统一，留给两束都签核后的阶段一致性
 * 复核裁决（`coverage.md` AI-6）。这里先落地占位码，不阻塞本束单独可用。
 */
export const AgentInterruptError = z.enum([
  "NOT_VISIBLE",
  "NO_WRITE_ROLE",
  "NO_ACTIVE_INTERRUPT",
  "INTERRUPT_KIND_MISMATCH",
  "STALE_INTERRUPT",
  "MALFORMED_RESUME_PAYLOAD",
  "SELECTED_OPTION_NOT_FOUND",
  "AUDIT_SINK_UNAVAILABLE",
  "FIELD_REQUIRED_BLANK",
]);
export type AgentInterruptError = z.infer<typeof AgentInterruptError>;

/* ── 七、实体（domain.md 四节）────────────────────────────────────────
 * `InterruptRequest` 不是新表——它是 `agent_run_steps` 一条
 * `status = "awaiting_tool_permission"` 行的投影（不变量 I-9），本文件只声明这份投影的形状，
 * 不建议独立持久化。 */

export const InterruptRequest = z.object({
  requestId: z.string().min(1),
  kind: AgentInterruptKind,
  toolName: z.string().min(1),
  args: z.union([ConfirmIntentArgs, FillParamsArgs, ChooseOptionArgs]),
  status: z.enum(["pending", "resolved"]),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  decision: z.enum(["approve", "edit", "reject"]).nullable(),
});
export type InterruptRequest = z.infer<typeof InterruptRequest>;

/* ── 八、事件流参数截断豁免（domain.md 缺口 AI-3）────────────────────── *
 * 与 `deep-agent-hitl.ts` 的 `DEEP_AGENT_HITL_ARGS_MAX_CHARS` 同一纪律：待批工具的
 * args 要被前端 `JSON.parse`（渲染卡片、edit 决策改参数再提交），不是给人读的摘要，
 * 默认 500 字符截断会把它切成非法 JSON。`fill_params` 多字段 + 依据文案、
 * `choose_option` 2-3 张选项卡三项对照，都大概率超过 500 字符。
 * `deep-agent-model-provider.ts` 的豁免清单是**封闭清单**，三个新工具名必须逐一加行
 * （不能整类放行，同 `PLUMBING_CUSTOM_EVENT_NAMES` 纪律），落地在
 * `apps/api/src/infrastructure/agent-run/deep-agent-model-provider.ts`。 */
export const AGENT_INTERRUPTS_ARGS_MAX_CHARS = 4000;

/** 三个工具名的数组形式，供豁免清单/环境变量投影等处直接 `includes`/`join`，不手写字面量。 */
export const AGENT_INTERRUPTS_TOOL_NAME_LIST: readonly string[] = [
  AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent,
  AGENT_INTERRUPTS_TOOL_NAMES.fillRunParams,
  AGENT_INTERRUPTS_TOOL_NAMES.chooseExecutionOption,
];

/**
 * 本束贡献给 `harness.py` 固定 HITL 工具清单的那一段（design-signoff §四表：
 * 拼装点是 `deep-agent-hitl.ts` 与本文件「各取工具名再 `.join(",")`」）。
 * `[DEEP_AGENT_HITL_TOOL_NAME, ...AGENT_INTERRUPTS_TOOL_NAME_LIST]` 就是
 * `harness.py` 的 `DEFAULT_HITL_TOOL_NAMES` 应有的完整清单，这里只导出本束的
 * 那一半，不 import `deep-agent-hitl.ts`（design-signoff §六 决策④：两个文件
 * 各自是各自工具名的唯一事实源，不互相 import 造出一个隐藏的耦合面；由消费方
 * 在自己的层做拼接）。
 *
 * Phase 14 F02（R6）之前，这段值经由 `DEEP_AGENT_HITL_TOOLS` 环境变量投影进
 * 部署配置；该开关已验证稳定、按 R6 要求默认开启且开关本身移除——现在
 * `harness.py` 直接把这份并集硬编码进 `DEFAULT_HITL_TOOL_NAMES`，不再有
 * 环境变量这一层，本常量改由跨语言门控测试
 * （`cross-lang-tool-parity.test.ts`）断言这份并集与 Python 常量一致。
 */
export const AGENT_INTERRUPTS_HITL_TOOLS_ENV_VALUE = AGENT_INTERRUPTS_TOOL_NAME_LIST.join(",");

/** Explicit user-facing form payload only; arbitrary tool arguments never enter this projection. */
export const RestorableInterrupt = z.discriminatedUnion("toolName", [
  z.object({ toolName: z.literal(AGENT_INTERRUPTS_TOOL_NAMES.confirmTaskIntent), args: ConfirmIntentArgs }),
  z.object({ toolName: z.literal(AGENT_INTERRUPTS_TOOL_NAMES.fillRunParams), args: FillParamsArgs }),
  z.object({ toolName: z.literal(AGENT_INTERRUPTS_TOOL_NAMES.chooseExecutionOption), args: ChooseOptionArgs }),
]);
export type RestorableInterrupt = z.infer<typeof RestorableInterrupt>;
