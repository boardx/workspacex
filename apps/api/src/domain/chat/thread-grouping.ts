/**
 * 线程按时间分组 —— 「今天」/「本周」/「更早」三组（uc-8-1 R3 / 契约 `listThreads`）。
 *
 * ## 「更早」的由来（domain.md 待裁决第 11 条，2026-09-07 已裁）
 *
 * 本函数曾经只认「今天」「本周」两档，本周之前的线程直接返回 `null` 意味着
 * **不出现在响应里**——数据完好，只是永远找不回来。2026-09-07 实测事故：
 * 一个正常使用的账号，只因为「今天」恰好是本 ISO 周的周一（上一次活动落在
 * 上周日），个人对话列表瞬间清空到只剩当天新建的那一条，被误判为「数据库被
 * 清空了」。查证过程见 issue #2894 / #2898。
 *
 * 人类随后直接裁决（issue #2898）：**所有历史记录都要可以浏览**，参照 Codex
 * 的历史对话面板——不是「等产品重新设计」，是「不能再丢」。于是本函数改为
 * **恒不返回 null**：本周之前的一切归入「更早」，永远可数、永远能找回来。
 *
 * ⚠ 「更早」目前是**一整个桶**，不再按月/按年细分，也没有分页——187 条这个量级
 *   一次性返回没有问题；量级显著变大（比如四位数）后再加游标分页是合理的下一步，
 *   不在本次范围内（本次要解决的是「消失」，不是「分页体验」）。
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
import { z } from "zod";
import { chat as C } from "@repo/contracts";

/** 契约是单源（`packages/contracts/src/chat.ts` 的 `ThreadGroupLabel`），这里只引用，不重定义。 */
export type ThreadGroupLabel = z.infer<typeof C.ThreadGroupLabel>;

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
 * 一条线程归哪一组。**恒有归宿**（2026-09-07 起）：本周之前一律「更早」，
 * 不再返回 `null` 把线程从响应里丢掉。
 */
export function threadGroupLabel(lastActivityAt: Date, now: Date): ThreadGroupLabel {
  const day = utcDayIndex(lastActivityAt);
  const today = utcDayIndex(now);
  if (day === today) return "今天";
  // 未来时间戳（时钟漂移 / 手工数据）按「今天」处理而不是丢弃：丢弃会让一条线程
  // 从列表里消失，而消失与「不可见」在界面上无法区分。
  if (day > today) return "今天";
  return isoWeekStartIndex(lastActivityAt) === isoWeekStartIndex(now) ? "本周" : "更早";
}

/** 组的固定顺序。恒三组、恒此顺序，**空组也在**——组标题常驻（uc-8-1 R8）。 */
export const THREAD_GROUP_ORDER: readonly ThreadGroupLabel[] = ["今天", "本周", "更早"];
