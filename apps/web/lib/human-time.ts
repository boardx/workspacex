/**
 * 「什么时候」的人话（单源）。
 *
 * 迭代 28 写在版本历史面板里；迭代 29 搬到这里——分享弹窗与访客分享页各自写着
 * `new Date(x).toLocaleString("zh-CN")`，屏上是「2026/9/22 20:41:03」这种带秒的机器时间。
 * 对读它的人来说，真正的问题从来是「这是不是刚才的/是不是最新的」，而不是第几秒。
 * 同一事实不得声明在两处：三处共用这一份。
 */

import { translate } from "./i18n/messages";
import type { Locale } from "./i18n/locale";

/** 近的说相对时间，远的才落到日期；`now` 可注入，测试不靠真实时钟。 */
export function humanTime(iso: string, now: number = Date.now(), locale: Locale = "zh-CN"): string {
  const d = new Date(iso);
  const t = d.getTime();
  if (Number.isNaN(t)) return iso;
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const min = Math.floor((now - t) / 60000);
  // 未来时间（时钟偏差）不说「-3 分钟前」，退回到时刻本身。
  if (min < 0) return hhmm;
  if (min < 1) return translate(locale, "designShare.time.justNow");
  if (min < 60) return translate(locale, "designShare.time.minutes", { count: min });
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (t >= startOfToday.getTime()) return translate(locale, "designShare.time.today", { time: hhmm });
  if (t >= startOfToday.getTime() - 86400000) return translate(locale, "designShare.time.yesterday", { time: hhmm });
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
}
