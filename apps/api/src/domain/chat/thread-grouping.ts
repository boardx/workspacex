/**
 * 线程按时间分组 —— **只有「今天」与「本周」两组**（uc-8-1 R3 / 契约 `listThreads`）。
 *
 * ## 为什么没有「更早」
 *
 * 原型档案里「更早」**0 命中**，`domain.md` 待裁决第 11 条把「更久线程怎么归组、
 * 怎么找回来」原样挂着等产品定义。契约 `listThreads.out` 的 `label` 是
 * `z.enum(["今天","本周"])`——两个字面量，没有第三档。
 *
 * 所以本周之前的线程**不出现在返回值里**。这是**已知的功能缺失**，不是过滤：
 * 它与「不泄露存在但不可见的条目数」（uc-8-5 V9）恰好同形——都不返回、也不返回计数——
 * 于是没有任何断言能把两者分开。⇒ 这一条写在这里，让下一个人知道
 * 「老线程找不回来」是**待裁**而不是 bug。
 *
 * ## 纯函数
 *
 * 没有 `new Date()`。`now` 由调用方给（`Clock` 端口），因为「今天」这个词的判定
 * 依赖当前时刻，而依赖当前时刻的函数如果自己去取时刻，就没有一个能测的边界——
 * 「23:59:59 的线程在 00:00:01 之后属于昨天」这条断言写不出来。
 *
 * ⚠ 时区取 **UTC**。`domain.md` 与 UC 都没写按谁的时区分组；选 UTC 是因为它是
 *   **可指名的**、跨用户一致的一个选择，而「服务器本地时区」会随部署环境变。
 *   按用户时区分组需要一个「用户时区」的事实源，本阶段没有 ⇒ 登记为缺口，不擅自造。
 */

export type ThreadGroupLabel = "今天" | "本周";

/** UTC 日历日的序号（1970-01-01 = 0）。用它比较，而不是比较毫秒差。 */
function utcDayIndex(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
}

/**
 * ISO 周的周一那天的日序号。周一为一周之始（ISO-8601）。
 *
 * `getUTCDay()` 星期日返回 0，所以这里把它折成 7 —— 少了这一步，星期日会被算成
 * 「本周的第 0 天」，于是周日的线程与下周一的线程归到同一周。
 */
function isoWeekStartIndex(d: Date): number {
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return utcDayIndex(d) - (dow - 1);
}

/**
 * 一条线程归哪一组；本周之前返回 `null`（**不归组 ⇒ 不返回**，见文件头）。
 */
export function threadGroupLabel(lastActivityAt: Date, now: Date): ThreadGroupLabel | null {
  const day = utcDayIndex(lastActivityAt);
  const today = utcDayIndex(now);
  if (day === today) return "今天";
  // 未来时间戳（时钟漂移 / 手工数据）按「今天」处理而不是丢弃：丢弃会让一条线程
  // 从列表里消失，而消失与「不可见」在界面上无法区分。
  if (day > today) return "今天";
  return isoWeekStartIndex(lastActivityAt) === isoWeekStartIndex(now) ? "本周" : null;
}

/** 组的固定顺序。恒两组、恒此顺序，**空组也在**——组标题常驻（uc-8-1 R8）。 */
export const THREAD_GROUP_ORDER: readonly ThreadGroupLabel[] = ["今天", "本周"];
