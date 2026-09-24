/**
 * GTM 活动与漏斗 schema（backlog D2）——运营平面只存**聚合与不透明 ID**。
 *
 * 硬约束（与事故 schema 同一条）：运营平面不存客户内容 / 客户个人信息 / 凭据值 / 计费账本 /
 * 客户可审计证据。落到本 schema 上就是：
 *   · 活动只有不透明 id + 渠道枚举 + 起止日期——**没有活动名称 / 备注这类自由文本**；
 *   · 漏斗只有「某活动 × 某天 × 每一步的人数」——没有邮箱、姓名、IP、线索 id、任何逐人记录；
 *   · 转化率不落盘，读时由计数算出（同一事实不存两处）。
 *
 * 门控：`pnpm run lint:ops-gtm-schema`（复用 lint-telemetry-schema.mjs：strict、数组上限、
 * 字符串受约束、字段名不像个人信息，0 叶子判红）+ test/gtm.test.ts。
 */
import { z } from "zod";

/** 漏斗步骤，按顺序；转化率 = 本步 / 上一步。 */
export const FUNNEL_STEPS = ["visit", "signup", "instance_ready", "first_value", "retained_7d"] as const;
export const CHANNELS = ["organic", "referral", "event", "partner", "paid_search", "social", "email_newsletter", "other"] as const;
export const CAMPAIGN_STATUSES = ["planned", "running", "ended"] as const;

const CampaignId = z.string().regex(/^cmp_[a-z0-9]{8,32}$/);
const Day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const Timestamp = z.string().datetime();
/** 单日单步人数：非负整数，上限只防误传，不是业务上限。 */
const Count = z.number().int().min(0).max(100_000_000);

export const StepCounts = z.object(
  Object.fromEntries(FUNNEL_STEPS.map((s) => [s, Count])) as { [K in (typeof FUNNEL_STEPS)[number]]: typeof Count },
).strict();

export const CampaignRecord = z.object({
  id: CampaignId,
  channel: z.enum(CHANNELS),
  status: z.enum(CAMPAIGN_STATUSES),
  startsOn: Day,
  endsOn: Day.optional(),
  createdAt: Timestamp,
}).strict();
export type CampaignRecord = z.infer<typeof CampaignRecord>;

export const FunnelDay = z.object({
  campaignId: CampaignId,
  day: Day,
  counts: StepCounts,
}).strict();
export type FunnelDay = z.infer<typeof FunnelDay>;

export const CreateCampaignInput = CampaignRecord.omit({ createdAt: true }).strict();
export const UpdateCampaignInput = z.object({ status: z.enum(CAMPAIGN_STATUSES).optional(), endsOn: Day.optional() }).strict();

/** 摄入：一批「活动 × 天」的计数。同一 (活动, 天) 再次摄入 = 覆盖（幂等重放）。 */
export const FunnelIngestBatch = z.object({ days: z.array(FunnelDay).min(1).max(400) }).strict();

/** 运营平面 GTM 存储的全部形状——lint 门控的根。 */
export const GtmStoredShapes = z.object({ campaign: CampaignRecord, funnelDay: FunnelDay }).strict();

export type Step = (typeof FUNNEL_STEPS)[number];
/** 读时派生：每一步相对上一步的转化率；上一步为 0 ⇒ null（不编造比率）。 */
export function conversionRates(counts: Record<Step, number>): Record<Step, number | null> {
  const out = {} as Record<Step, number | null>;
  FUNNEL_STEPS.forEach((s, i) => {
    if (i === 0) { out[s] = null; return; }
    const prev = counts[FUNNEL_STEPS[i - 1]!];
    out[s] = prev === 0 ? null : Math.round((counts[s] / prev) * 10_000) / 10_000;
  });
  return out;
}
