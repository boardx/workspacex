/**
 * Issue #4363（S6）—— 记忆的时间维度，纯函数部分：
 *
 *   1. 把抽取模型从原话里摘出来的**时间说法**（「这周」「到年底」「下个月之前」……）换算成绝对时间。
 *      模型只负责「这句话里哪一段是时间说法」（它懂语言）；日历算术在这里做（确定、可测、不依赖模型记得今天几号）。
 *      说法认不出 ⇒ null（这条记忆不带有效期，照旧长期有效——宁可多记，不能把话记成「已过期」）。
 *   2. 「过期了没有」只有 `claimExpired` 一处判定：召回（recall.ts）、面板与大脑页的「已过期」标记都用它。
 *
 * 区间一律左闭右开：`until` 是**第一个不再成立的时刻**（「这周」⇒ 下周一 00:00）。数据库的 `valid_to` 存的就是它。
 *
 * 时区：说「这周」「今天」的人按本地日历说话。本产品面向中国大陆用户（PROJECT.md），这里按 UTC+8 切日历；
 * 以后按用户设置的时区切，只改 `KG_CALENDAR_OFFSET_MINUTES` 的来源。
 */

/** 切日历用的时区偏移（分钟，东正西负）。 */
export const KG_CALENDAR_OFFSET_MINUTES = 8 * 60;

export interface ClaimTimeRange {
  /** 从什么时候开始成立（ISO）。说法只给了终点（「到年底」）⇒ 就是说话的时刻。 */
  readonly from: string;
  /** 第一个不再成立的时刻（ISO，左闭右开）。 */
  readonly until: string;
}

const DAY = 24 * 60 * 60 * 1000;

/** 本地日历的年月日（按偏移换算），与它回到 UTC 的换算。 */
interface LocalDate { readonly y: number; readonly m: number; readonly d: number }
function local(at: Date, offset: number): LocalDate & { readonly dow: number } {
  const t = new Date(at.getTime() + offset * 60_000);
  // getUTCDay：0 = 周日；换成 0 = 周一
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), dow: (t.getUTCDay() + 6) % 7 };
}
function startOf(date: LocalDate, offset: number): Date {
  return new Date(Date.UTC(date.y, date.m, date.d) - offset * 60_000);
}

const CN_DIGIT: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
/** 「3」「三」「十二」「12」→ 数字；认不出 ⇒ null。只需覆盖月份与日期（1–31）。 */
function num(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "十") return 10;
  const m = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(s);
  if (m !== null) return (m[1] === undefined ? 1 : CN_DIGIT[m[1]]!) * 10 + (m[2] === undefined ? 0 : CN_DIGIT[m[2]]!);
  return s.length === 1 ? CN_DIGIT[s] ?? null : null;
}

const N = "(\\d{1,2}|[一二两三四五六七八九十]{1,3})";

/**
 * 时间说法 → 区间。`at` 是说这句话的时刻（消息时间）。
 * 认得：今天 / 明天 / 这周（本周、这个星期、这礼拜）/ 下周 / 这个月（本月）/ 月底 / 下个月 / 下个月之前 /
 * 今年（年底、到年底、年内）/ 明年 / 「N 月底」「N 月 D 日（号）之前」。
 * 「之前 / 前 / 以前」表示截止在那个时段开始之前（「下个月之前」⇒ 到本月底）；「内 / 之内 / 为止 / 到…」表示那个时段结束。
 */
export function resolveTimeExpression(expression: string, at: Date, offset: number = KG_CALENDAR_OFFSET_MINUTES): ClaimTimeRange | null {
  const s = expression.normalize("NFKC").replace(/\s+/g, "");
  if (s === "" || !Number.isFinite(at.getTime())) return null;
  const today = local(at, offset);
  const range = (from: Date, until: Date): ClaimTimeRange | null =>
    until.getTime() > at.getTime() ? { from: (from.getTime() > at.getTime() ? from : at).toISOString(), until: until.toISOString() } : null;
  // 「…之前 / …前 / …以前」：截止在那个时段开始的时刻
  const before = /(?:之前|以前|前)$/.test(s) && !/^(?:目前|当前|眼前)$/.test(s);
  const day = (offsetDays: number) => startOf({ y: today.y, m: today.m, d: today.d + offsetDays }, offset);
  const monthStart = (addMonths: number) => startOf({ y: today.y, m: today.m + addMonths, d: 1 }, offset);
  const yearStart = (addYears: number) => startOf({ y: today.y + addYears, m: 0, d: 1 }, offset);
  const weekStart = (addWeeks: number) => day(-today.dow + addWeeks * 7);

  const explicit = new RegExp(`^(?:到|在)?${N}月(?:(底|末)|${N}[日号])(?:之前|以前|前|为止)?$`).exec(s);
  if (explicit !== null) {
    const month = num(explicit[1]!);
    if (month === null || month < 1 || month > 12) return null;
    // 说的月份已经过去 ⇒ 指明年那个月（12 月说「3 月底」）
    const year = month - 1 < today.m ? today.y + 1 : today.y;
    if (explicit[2] !== undefined) return range(at, startOf({ y: year, m: month, d: 1 }, offset));
    const d = num(explicit[3]!);
    if (d === null || d < 1 || d > 31) return null;
    const target = startOf({ y: year, m: month - 1, d }, offset);
    return range(at, before ? target : new Date(target.getTime() + DAY));
  }

  if (/^(?:今天|今日|当天)/.test(s)) return range(at, day(1));
  if (/^(?:明天|明日)/.test(s)) return before ? range(at, day(1)) : range(day(1), day(2));
  if (/^(?:到)?(?:这周|本周|这个?星期|这礼拜|这个礼拜|周末)/.test(s)) return range(at, weekStart(1));
  if (/^(?:下周|下个?星期|下礼拜|下个礼拜)/.test(s)) return before ? range(at, weekStart(1)) : range(weekStart(1), weekStart(2));
  if (/^(?:到)?(?:这个月|本月|月底|月末)/.test(s)) return range(at, monthStart(1));
  if (/^(?:下个月|下月)/.test(s)) return before ? range(at, monthStart(1)) : range(monthStart(1), monthStart(2));
  if (/^(?:到)?(?:今年|年底|年末|年内|本年)/.test(s)) return range(at, yearStart(1));
  if (/^(?:明年)/.test(s)) return before ? range(at, yearStart(1)) : range(yearStart(1), yearStart(2));
  return null;
}

/** 这条记忆到 `now` 已经过期了吗（`until` 左闭右开：到了那一刻就不再成立）。没有有效期 ⇒ 永不过期。 */
export function claimExpired(validUntil: string | null | undefined, now: Date): boolean {
  if (validUntil === null || validUntil === undefined) return false;
  const t = Date.parse(validUntil);
  return Number.isFinite(t) && t <= now.getTime();
}
