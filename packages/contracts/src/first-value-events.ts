/**
 * PROPOSED —— 第一个价值时刻的事件目录（backlog E1，E3 埋点的前置）。**待人类签核，尚未生效。**
 *
 * 与 `instance-telemetry.ts`（S2，同为 PROPOSED）同一处境，照它的先例办理：**不从 `index.ts` 导出**，
 * 不改任何既有操作；签核之后才允许控制器消费。定义与理由见 `docs/research/first-value-moment.md`。
 *
 * ## 第一个价值时刻（一句话）
 *
 * **一个组织第一次拿到一条「引用了它自己上传的材料」的智能体回答。**
 * 时间预算：从该组织第一次登录起 ≤ {@link FIRST_VALUE_BUDGET_MINUTES} 分钟。
 *
 * ## 两层：本地事实 → 计数上报
 *
 * | 层 | 形状 | 离不离开实例 |
 * |---|---|---|
 * | 本地事实 | {@link FirstValueLocalFact}：某组织某一步第一次发生的时刻 | **永不离开**，只在实例内聚合 |
 * | 计数上报 | {@link FirstValueFunnelReport}：本周期各步到达的组织数 + 耗时中位数 | **仅在 `usage` 同意开启时**（D16/D22：默认关） |
 *
 * 每个事件都是「计数的事实」：到没到、何时到。没有任何自由文本、文件名、问题原文或回答原文——
 * 由 `.harness/scripts/lint-telemetry-schema.mjs` 对两层 schema 都做机械检查。
 * `personal-local` 组织的事实在本地照样记（给本机用户自己看），但**不进入**计数上报。
 */
import { z } from "zod";
import { InstanceId } from "./instance-telemetry";
import type { TelemetryConsentItemValue } from "./instance-telemetry";

/** 价值时刻的时间预算（分钟），从组织第一次登录算起。 */
export const FIRST_VALUE_BUDGET_MINUTES = 15;

/**
 * 漏斗各步——**按顺序**，本契约内的唯一事实源。最后一步 `cited_answer_own_material` 就是价值时刻。
 * 每步只记「该组织第一次发生」，所以每步对每个组织至多一条事实。
 */
export const FirstValueStep = z.enum([
  /** 组织内第一次有人登录成功（计时起点）。 */
  "first_sign_in",
  /** 第一次打开项目或线程（进入工作区，不再停在空白首页）。 */
  "workspace_opened",
  /** 在内置脱敏示例项目上拿到一条带引用的回答（E2；证明链路通，但不算价值时刻）。 */
  "cited_answer_sample",
  /** 第一次上传自己的材料（附件或文件，不是示例）。 */
  "own_material_uploaded",
  /** 第一次在挂有自己材料的线程里发起提问。 */
  "question_on_own_material",
  /** 价值时刻：智能体回答里至少一条引用指向该组织自己上传的材料。 */
  "cited_answer_own_material",
  /** 价值之后的复核：第一次点开引用看原件出处（D-最终读者体验）。 */
  "citation_opened",
]);
export type FirstValueStepValue = z.infer<typeof FirstValueStep>;

/** 价值时刻对应的那一步——只此一处声明。 */
export const FIRST_VALUE_STEP: FirstValueStepValue = "cited_answer_own_material";

/** 本地组织标识：与 identity 的组织 id 同形（短标识符，不可读名字）。只在本地层出现。 */
const LocalOrgId = z.string().regex(/^org-[A-Za-z0-9-]{1,64}$/);

/** 本地事实：某组织某步第一次发生。**永不离开实例。** */
export const FirstValueLocalFact = z
  .object({
    orgId: LocalOrgId,
    orgKind: z.enum(["standard", "personal-local"]),
    step: FirstValueStep,
    occurredAt: z.string().datetime(),
  })
  .strict();
export type FirstValueLocalFactValue = z.infer<typeof FirstValueLocalFact>;

const Count = z.number().int().min(0);

/** 每步到达的组织数——键集合固定为 {@link FirstValueStep}，多一个少一个都拒。 */
const StepCounts = z
  .object(Object.fromEntries(FirstValueStep.options.map((s) => [s, Count])) as Record<FirstValueStepValue, typeof Count>)
  .strict();

/** 计数上报：只在 `usage` 同意开启时离开实例。 */
export const FirstValueFunnelReport = z
  .object({
    schemaVersion: z.literal(1),
    instanceId: InstanceId,
    periodEnd: z.string().datetime(),
    /** 离开实例所依据的同意项——字面量，只能是 `usage`。 */
    consentItem: z.literal("usage"),
    excludesPersonalLocalOrgs: z.literal(true),
    /** 截至本周期末，累计到达各步的组织数（不含 personal-local）。 */
    orgsReachedStep: StepCounts,
    // 耗时中位数**不在这里**：它已是 S2 签核契约 `TelemetryBenchmark.firstValueMedianMinutes`
    // （benchmark 同意）。同一事实不在两处声明——由下面的 `firstValueMedianMinutes()` 算出去填它。
    /** 在预算内到达价值时刻的组织数。 */
    orgsWithinBudget: Count,
  })
  .strict()
  .superRefine((r, ctx) => {
    const reached = r.orgsReachedStep[FIRST_VALUE_STEP];
    if (r.orgsWithinBudget > reached) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["orgsWithinBudget"], message: "预算内到达数不能超过到达价值时刻的组织数" });
    }
  });
export type FirstValueFunnelReportValue = z.infer<typeof FirstValueFunnelReport>;

/** 漏斗计数能不能离开实例：只看 `usage` 一项同意（出厂默认关，D22）。 */
export function mayLeaveInstance(consent: Record<TelemetryConsentItemValue, boolean>): boolean {
  return consent.usage === true;
}

/** 每个组织每一步的最早时刻（排除 personal-local 与周期末之后的事实）。 */
function earliestByOrg(
  facts: readonly FirstValueLocalFactValue[],
  periodEnd: string,
): Map<string, Map<FirstValueStepValue, number>> {
  const end = Date.parse(periodEnd);
  const firstAt = new Map<string, Map<FirstValueStepValue, number>>();
  for (const f of facts) {
    if (f.orgKind === "personal-local") continue;
    const t = Date.parse(f.occurredAt);
    if (t > end) continue;
    const byStep = firstAt.get(f.orgId) ?? new Map<FirstValueStepValue, number>();
    const prev = byStep.get(f.step);
    if (prev === undefined || t < prev) byStep.set(f.step, t);
    firstAt.set(f.orgId, byStep);
  }
  return firstAt;
}

/** 各组织首次登录 → 价值时刻的分钟数（升序）。 */
function minutesToFirstValue(firstAt: Map<string, Map<FirstValueStepValue, number>>): number[] {
  const minutes: number[] = [];
  for (const byStep of firstAt.values()) {
    const start = byStep.get("first_sign_in");
    const value = byStep.get(FIRST_VALUE_STEP);
    if (start !== undefined && value !== undefined && value >= start) minutes.push((value - start) / 60_000);
  }
  return minutes.sort((a, b) => a - b);
}

/**
 * 首次登录 → 价值时刻的耗时中位数（分钟）；无人到达返回 undefined。
 * 用来填 S2 契约的 `TelemetryBenchmark.firstValueMedianMinutes`（benchmark 同意），不另立字段。
 */
export function firstValueMedianMinutes(
  facts: readonly FirstValueLocalFactValue[],
  periodEnd: string,
): number | undefined {
  const m = minutesToFirstValue(earliestByOrg(facts, periodEnd));
  if (m.length === 0) return undefined;
  const mid = m.length >> 1;
  return m.length % 2 ? m[mid]! : (m[mid - 1]! + m[mid]!) / 2;
}

/**
 * 本地聚合：把本地事实算成计数上报。纯函数，不做 I/O。
 * personal-local 组织被排除；同一组织同一步重复出现只取最早一条。
 */
export function aggregateFirstValueFunnel(
  facts: readonly FirstValueLocalFactValue[],
  meta: { instanceId: string; periodEnd: string },
): FirstValueFunnelReportValue {
  const firstAt = earliestByOrg(facts, meta.periodEnd);
  const counts = Object.fromEntries(FirstValueStep.options.map((s) => [s, 0])) as Record<FirstValueStepValue, number>;
  for (const byStep of firstAt.values()) for (const s of byStep.keys()) counts[s]++;
  return FirstValueFunnelReport.parse({
    schemaVersion: 1,
    instanceId: meta.instanceId,
    periodEnd: meta.periodEnd,
    consentItem: "usage",
    excludesPersonalLocalOrgs: true,
    orgsReachedStep: counts,
    orgsWithinBudget: minutesToFirstValue(firstAt).filter((m) => m <= FIRST_VALUE_BUDGET_MINUTES).length,
  });
}
