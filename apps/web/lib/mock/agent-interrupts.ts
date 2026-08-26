/**
 * agent-interrupts 契约束 —— UI 先行原型的 mock 数据（ADR-003 第 ① 件材料）。
 *
 * 数据形状逐字对齐 `phases/phase-01-run-a-project/contracts/agent-interrupts/domain.md`
 * 的三个值对象（ParamField / OptionCard）与实体（InterruptRequest.args）。
 * ⚠ 这里只是**预览用假数据**，不是契约本身——契约的单一事实源是
 *   `packages/contracts/src/agent-interrupts.ts`（F212，签核③已落地）。
 *
 * F212 起，`ConfirmIntentArgs`/`ParamField`/`OptionCard` 从契约派生（`lint-contract-source`
 * ADR-020 单一事实源门控），不再手写同名 interface——`kind`/`options` 是本文件独有的
 * **预览渲染专用**扩展字段（决定 mock 面板画哪种输入控件），契约本身不关心这两个字段。
 *
 * mock 刻意做到「像真的」：字段数量、依据文案、选项对照都取一个真实的
 * 「生成 7 月增长月报」场景，而不是三行占位符——信息密度问题要在截图里看得出来。
 */
import type * as AgentInterrupts from "@repo/contracts/agent-interrupts";

/* ── 视角（R5 委托 chat UC-0 的角色语义；观察者恒无写权）───────────────── */
export type InterruptRole = "facilitator" | "lead" | "member" | "observer";

export interface RoleDef {
  readonly key: InterruptRole;
  readonly label: string;
  /** 是否有写权 —— 决策接口是否可用（观察者恒 false，走 denied 态）*/
  readonly canWrite: boolean;
}

export const INTERRUPT_ROLES: readonly RoleDef[] = [
  { key: "facilitator", label: "引导师", canWrite: true },
  { key: "lead", label: "组长", canWrite: true },
  { key: "member", label: "组员", canWrite: true },
  { key: "observer", label: "观察者", canWrite: false },
];

export function resolveRole(raw: string | string[] | undefined): InterruptRole {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const keys = INTERRUPT_ROLES.map((r) => r.key);
  return keys.includes(v as InterruptRole) ? (v as InterruptRole) : "facilitator";
}
export function roleDef(role: InterruptRole): RoleDef {
  return INTERRUPT_ROLES.find((r) => r.key === role) ?? INTERRUPT_ROLES[0]!;
}

/* ── 屏 ────────────────────────────────────────────────────────────────── */
export type InterruptScreen = "confirm-intent" | "fill-params" | "choose-option";
export const INTERRUPT_SCREENS: readonly { key: InterruptScreen; label: string }[] = [
  { key: "confirm-intent", label: "目标复述卡" },
  { key: "fill-params", label: "参数补全表单" },
  { key: "choose-option", label: "多方案对比" },
];
export function resolveScreen(raw: string | string[] | undefined): InterruptScreen {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const keys = INTERRUPT_SCREENS.map((s) => s.key);
  return keys.includes(v as InterruptScreen) ? (v as InterruptScreen) : "confirm-intent";
}

/* ── UC-1 confirm_intent ─────────────────────────────────────────────────── */
export type ConfirmIntentArgs = AgentInterrupts.ConfirmIntentArgs;

export const MOCK_CONFIRM_INTENT: ConfirmIntentArgs = {
  requestId: "req-confirm-1",
  understanding:
    "你希望我基于 7 月的渠道与转化数据，生成一份面向管理层的增长月度复盘，" +
    "并在结尾给出下一步可执行的建议。",
  assumptions: [
    "对比口径采用「同比（YoY）」，而非环比——与管理层看板保持一致。",
    "数据范围截至 2026-07-31，不含 8 月至今尚未补录的渠道数据。",
    "报告受众是管理层，因此侧重结论与建议、弱化逐条明细表。",
  ],
};

/* ── UC-2 fill_params ────────────────────────────────────────────────────── */
/** `AgentInterrupts.ParamField` 是契约的单一事实源；`kind`/`options` 是本文件
 * 独有的预览渲染扩展（决定 mock 面板画哪种输入控件），契约不关心这两个字段。
 * ⚠ 用 `import("@repo/contracts/agent-interrupts")` 内联类型引用（而不是顶部已导入的
 * `AgentInterrupts` 命名空间别名），是为了让 `lint-contract-source.mjs` 的
 * 单一事实源正则能在这一行**扫描到**契约引用——它按「首个分号前的文本」截取右值，
 * 命名空间别名 + 交叉类型会让契约引用落在被截断的那一段之外，误判成手写第二份。 */
export type ParamField = import("@repo/contracts/agent-interrupts").ParamField & {
  readonly kind: "text" | "select" | "boolean",
  readonly options?: readonly { value: string, label: string }[],
};

export const MOCK_FILL_PARAMS: readonly ParamField[] = [
  {
    name: "compare_baseline",
    label: "对比基准",
    aiGuess: "同比（YoY）",
    rationale: "近 6 份月报都用同比口径，与管理层看板一致。",
    required: true,
    currentValue: "同比（YoY）",
    kind: "select",
    options: [
      { value: "yoy", label: "同比（YoY）" },
      { value: "mom", label: "环比（MoM）" },
      { value: "none", label: "不做对比" },
    ],
  },
  {
    name: "report_period",
    label: "报告周期",
    aiGuess: "2026-07",
    rationale: "取自当前草稿的关联周期字段。",
    required: true,
    currentValue: "2026-07",
    kind: "text",
  },
  {
    name: "include_forecast",
    label: "是否包含下月预测段落",
    aiGuess: false,
    rationale: "上一期月报未包含预测段落，沿用同一结构。",
    required: false,
    currentValue: false,
    kind: "boolean",
  },
  {
    name: "narrative_tone",
    label: "叙述语气",
    aiGuess: "稳健中性",
    rationale: "沿用季度汇报既定语气，避免夸张措辞。",
    required: false,
    currentValue: "稳健中性",
    kind: "select",
    options: [
      { value: "steady", label: "稳健中性" },
      { value: "upbeat", label: "积极进取" },
      { value: "cautious", label: "审慎保守" },
    ],
  },
  {
    // required && aiGuess === null —— 无高亮，走「必填未填」校验态
    name: "cc_recipients",
    label: "抄送对象（邮箱，逗号分隔）",
    aiGuess: null,
    rationale: null,
    required: true,
    currentValue: null,
    kind: "text",
  },
];

/* ── UC-3 choose_option ──────────────────────────────────────────────────── */
export type OptionCard = AgentInterrupts.OptionCard;

export const MOCK_OPTIONS_3: readonly OptionCard[] = [
  {
    optionId: "opt-quickwin",
    title: "先做快赢清单",
    effort: "低",
    timeToValue: "即时",
    expectedReturn: "锁定 3 项可本周落地的改动，预计拉动转化 +1.5pt。",
  },
  {
    optionId: "opt-experiment",
    title: "小流量 A/B 实验",
    effort: "中",
    timeToValue: "≈4 天",
    expectedReturn: "以 10% 流量验证两版落地页，产出可推广结论。",
  },
  {
    optionId: "opt-deepdive",
    title: "渠道归因深挖",
    effort: "高",
    timeToValue: "≈2 周",
    expectedReturn: "定位增长根因、指导下季度预算再分配，潜在 +6pt 但不确定性高。",
  },
];

/** I-5：options ∈ [2,3] —— 2 张态用前两张 */
export const MOCK_OPTIONS_2: readonly OptionCard[] = MOCK_OPTIONS_3.slice(0, 2);
