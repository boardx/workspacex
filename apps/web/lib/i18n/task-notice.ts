import type { Notification } from "@repo/contracts/notifications";
import type { Locale } from "./locale";

const labels = {
  "已完成": "Completed",
  "执行失败": "Failed",
  "已暂停": "Paused",
  "等待你确认计划": "Waiting for plan confirmation",
  "等待你授权工具": "Waiting for tool authorization",
} as const;

/** Localize stored run notices by their system body and suffix, keeping the thread title intact. */
export function taskNoticeCopy(notice: Pick<Notification, "kind" | "title" | "body">, locale: Locale) {
  if (locale !== "en" || notice.kind !== "task") return notice;
  for (const [zh, en] of Object.entries(labels)) {
    const suffix = ` · ${zh}`;
    const actionable = notice.body === `任务${zh}，点开去处理。`;
    if (!notice.title.endsWith(suffix) || (!actionable && notice.body !== `任务${zh}，点开查看结果。`)) continue;
    const title = notice.title.slice(0, -suffix.length);
    return {
      title: `${title} · ${en}`,
      body: actionable ? "Open the task to respond." : "Open the task to view the result.",
    };
  }
  return notice;
}
