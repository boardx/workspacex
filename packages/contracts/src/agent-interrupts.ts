/**
 * 契约束 `agent-interrupts` — ③ API 契约（zod 单一事实源）
 *
 * 三种新的 HITL 中断——目标复述卡（`confirm_intent`）/ 参数补全表单（`fill_params`）/
 * 多方案对比（`choose_option`）——的 args 形状、统一失败枚举与三个用例端口。
 *
 * ⚠ 本束**没有独立 HTTP 面**（`usecases.md` 顶部已声明）：三个用例都是 langgraph
 * `interrupt()`/`resume` 语义在 application 层的投影，真正对外的 HTTP 面是既有的
 * `POST /copilotkit`（AG-UI 桥，`chat`/`agent-runtime` 束已有），本束不新开路由——
 * 所以下面 `operations` 里的每条端口都标 `hostedBy: "copilotkit-agui-bridge"`，
 * 不带 `method`/`path`（那两个字段属于会新开路由的操作，这里硬套会撒谎）。
 *
 * 具名虚拟工具的名字与三个 kind 的对应关系是**唯一事实源**，与
 * `apps/deep-agent-service` 侧的 `@tool` 定义之间的一致性由
 * `tests/agent-interrupts/cross-lang-tool-parity.test.ts` 逐字比对守（不 import，见
 * `domain.md` 七、跨语言边界）。
 *
 * 覆盖 feature：F212–F216（phase-01）。
 * 依据：`phases/phase-01-run-a-project/contracts/agent-interrupts/{domain,usecases,coverage}.md`
 * （签核 ①②③ 三件材料，`design-signoff.md` status: confirmed，confirmed_by: usamshen，
 * 2026-08-26）。
 */
import { z } from "zod";

/* ── 三个具名虚拟工具——kind 藏在工具名里，不是独立判别字段（domain.md 二） ── */

export const AGENT_INTERRUPT_TOOL_NAMES = {
  confirm_intent: "confirm_task_intent",
  fill_params: "fill_run_params",
  choose_option: "choose_execution_option",
} as const;

export const AgentInterruptKind = z.enum(["confirm_intent", "fill_params", "choose_option"]);
export type AgentInterruptKind = z.infer<typeof AgentInterruptKind>;

/* ── 值对象（domain.md 三）───────────────────────────────────────────── */

/**
 * `aiGuess !== null` 时 `rationale` 不得为 null（不变量 I-3，「有猜测必有依据」）——
 * 用 zod `.refine` 直接把这条断言表达成契约层的判定，不是文档里的一句话。
 */
export const ParamField = z
  .object({
    name: z.string(),
    label: z.string(),
    aiGuess: z.unknown().nullable(),
    rationale: z.string().nullable(),
    required: z.boolean(),
    currentValue: z.unknown().nullable(),
  })
  .strict()
  .refine((f) => f.aiGuess === null || f.rationale !== null, {
    message: "aiGuess non-null requires rationale non-null (I-3)",
    path: ["rationale"],
  });
export type ParamField = z.infer<typeof ParamField>;

/**
 * 三项固定对照的字段集是封闭的——`effort`/`timeToValue`/`expectedReturn` 三个，
 * 不多不少（domain.md 三，⚠ 新增第四项需要走契约修订）。
 */
export const OptionCard = z
  .object({
    optionId: z.string(),
    title: z.string(),
    effort: z.enum(["低", "中", "高"]),
    timeToValue: z.string(),
    expectedReturn: z.string(),
  })
  .strict();
export type OptionCard = z.infer<typeof OptionCard>;

export const ConfirmIntentArgs = z
  .object({
    understanding: z.string(),
    // 不变量 I-2：assumptions 长度 ≥ 2。
    assumptions: z.array(z.string()).min(2),
  })
  .strict();
export type ConfirmIntentArgs = z.infer<typeof ConfirmIntentArgs>;

export const FillParamsArgs = z.object({ fields: z.array(ParamField) }).strict();
export type FillParamsArgs = z.infer<typeof FillParamsArgs>;

export const ChooseOptionArgs = z
  .object({
    // 不变量 I-5：options 长度 ∈ [2, 3]。
    options: z.array(OptionCard).min(2).max(3),
  })
  .strict();
export type ChooseOptionArgs = z.infer<typeof ChooseOptionArgs>;

/**
 * `InterruptRequest` 不是新表——它是 `agent_run_steps`（`agent-runtime` 束实体）里
 * 一条 `status = "awaiting_approval"`、`toolName` 属于本束三个具名工具之一的行的
 * **投影**（不变量 I-9，避免「同一份状态两处存」，domain.md 四）。
 */
export const InterruptRequest = z
  .discriminatedUnion("kind", [
    z
      .object({
        requestId: z.string(),
        kind: z.literal("confirm_intent"),
        toolName: z.literal(AGENT_INTERRUPT_TOOL_NAMES.confirm_intent),
        args: ConfirmIntentArgs,
        status: z.enum(["pending", "resolved"]),
        createdAt: z.string(),
        resolvedAt: z.string().nullable(),
        decision: z.enum(["approve", "edit", "reject"]).nullable(),
      })
      .strict(),
    z
      .object({
        requestId: z.string(),
        kind: z.literal("fill_params"),
        toolName: z.literal(AGENT_INTERRUPT_TOOL_NAMES.fill_params),
        args: FillParamsArgs,
        status: z.enum(["pending", "resolved"]),
        createdAt: z.string(),
        resolvedAt: z.string().nullable(),
        decision: z.enum(["approve", "edit", "reject"]).nullable(),
      })
      .strict(),
    z
      .object({
        requestId: z.string(),
        kind: z.literal("choose_option"),
        toolName: z.literal(AGENT_INTERRUPT_TOOL_NAMES.choose_option),
        args: ChooseOptionArgs,
        status: z.enum(["pending", "resolved"]),
        createdAt: z.string(),
        resolvedAt: z.string().nullable(),
        decision: z.enum(["approve", "edit", "reject"]).nullable(),
      })
      .strict(),
  ]);
export type InterruptRequest = z.infer<typeof InterruptRequest>;

/* ── 统一失败枚举（usecases.md「统一失败枚举 AgentInterruptError」）───── */

/**
 * ⚠ `FIELD_REQUIRED_BLANK` 是占位码，不是最终码——`usecases.md` UC-2 逐字：
 * 「`err` 里的 `PLAN_CONSTRAINT_BLANK` 是占位提醒，不是最终码……最终码见签核时的
 * 裁决，草案先用 `FIELD_REQUIRED_BLANK`」。是否与 `plan-control.PlanControlError.
 * PLAN_CONSTRAINT_BLANK` 统一，留给两束都签核后的阶段一致性复核裁决
 * （`coverage.md` AI-6 / `design-signoff.md` XC-3）——本文件不代为裁决，照录占位码。
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

/* ── 三个用例端口（usecases.md UC-1/UC-2/UC-3）────────────────────────
 *
 * 三个都是**内部端口**：调用者身份来自 `CurrentPrincipal()`；可见性/写权判定
 * 全部委托 `chat` 束 UC-0（本束不重复定义角色语义，usecases.md「统一约定」）。
 */
export const operations = {
  /**
   * confirmTaskIntent —— UC-1 目标复述卡。
   * ⚠ 未确认前该 run 不执行任何后续工具调用（不变量 I-1，见 usecases.md UC-1 反证节：
   *   `agent_run_steps` 里 `toolName="confirm_task_intent"` 且
   *   `status="awaiting_approval"` 的行之后，同一 `runId` 不存在
   *   `createdAt` 更晚且 `status != "awaiting_approval"` 的工具调用行）。
   */
  confirmTaskIntent: {
    hostedBy: "copilotkit-agui-bridge" as const,
    kind: AGENT_INTERRUPT_TOOL_NAMES.confirm_intent,
    in: z.object({ requestId: z.string(), understanding: z.string(), assumptions: z.array(z.string()) }).strict(),
    out: z.union([
      z.object({ decision: z.literal("approve") }).strict(),
      z.object({ decision: z.literal("edit"), editedArgs: z.object({ assumptions: z.array(z.string()) }).strict() }).strict(),
    ]),
    err: [
      "NOT_VISIBLE",
      "NO_WRITE_ROLE",
      "NO_ACTIVE_INTERRUPT",
      "INTERRUPT_KIND_MISMATCH",
      "STALE_INTERRUPT",
      "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },

  /**
   * fillRunParams —— UC-2 参数补全表单。
   * ⚠ `appliedTo` 不是「精确子集重跑」（依赖 checkpoint fork，本仓未证实，缺口 AI-1）——
   *   只有 `"full-rerun" | "ledger-only"` 两态，如实降级（`domain.md` 六）。
   */
  fillRunParams: {
    hostedBy: "copilotkit-agui-bridge" as const,
    kind: AGENT_INTERRUPT_TOOL_NAMES.fill_params,
    in: z.object({ requestId: z.string(), fields: z.array(ParamField) }).strict(),
    out: z.union([
      z.object({ decision: z.literal("approve") }).strict(),
      z
        .object({
          decision: z.literal("edit"),
          editedArgs: z.object({ fields: z.array(z.object({ name: z.string(), value: z.unknown() }).strict()) }).strict(),
          appliedTo: z.enum(["full-rerun", "ledger-only"]),
        })
        .strict(),
    ]),
    err: [
      "NOT_VISIBLE",
      "NO_WRITE_ROLE",
      "NO_ACTIVE_INTERRUPT",
      "INTERRUPT_KIND_MISMATCH",
      "STALE_INTERRUPT",
      "AUDIT_SINK_UNAVAILABLE",
      "FIELD_REQUIRED_BLANK",
    ] as const,
  },

  /**
   * chooseExecutionOption —— UC-3 多方案对比。
   * ⚠ 走 `edit` 决策类型，不是 `respond`——`domain.md` 缺口 AI-2：本仓桥接层
   *   `parseHitlDecision` 是封闭三态，没有产出 `{type:"respond"}` 的分支；`edit`
   *   语义上够用且零桥接层代码改动（`usecases.md` UC-3 逐条排除表）。
   * ⚠ `selectedOptionId` 回指原始 `options[].optionId`，不用数组下标（不变量 I-6，
   *   防止并发/重渲染重排时静默选错）。
   */
  chooseExecutionOption: {
    hostedBy: "copilotkit-agui-bridge" as const,
    kind: AGENT_INTERRUPT_TOOL_NAMES.choose_option,
    in: z.object({ requestId: z.string(), options: z.array(OptionCard).min(2).max(3) }).strict(),
    out: z.object({ decision: z.literal("edit"), editedArgs: z.object({ selectedOptionId: z.string() }).strict() }).strict(),
    err: [
      "NOT_VISIBLE",
      "NO_WRITE_ROLE",
      "NO_ACTIVE_INTERRUPT",
      "INTERRUPT_KIND_MISMATCH",
      "STALE_INTERRUPT",
      "SELECTED_OPTION_NOT_FOUND",
      "AUDIT_SINK_UNAVAILABLE",
    ] as const,
  },
} as const;

export type Operations = typeof operations;

/**
 * `ARGS_MAX_CHARS` 豁免表是按工具名等值比较的封闭清单（`deep-agent-model-provider.ts:
 * 243-244`），需要显式加行，不能整类放行（domain.md 缺口 AI-3）。这里导出三个工具名
 * 供实现期往那份清单里逐一加行——**本文件本身不改那份清单**（那是实现代码，不是契约）。
 */
export const AGENT_INTERRUPT_ARGS_MAX_CHARS_EXEMPT_TOOLS = [
  AGENT_INTERRUPT_TOOL_NAMES.confirm_intent,
  AGENT_INTERRUPT_TOOL_NAMES.fill_params,
  AGENT_INTERRUPT_TOOL_NAMES.choose_option,
] as const;
