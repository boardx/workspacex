/**
 * UC-17.8 B1 —— 从正文派生反馈标题的**权威**规则（契约 `submitFeedbackDraft` 头注）。
 *
 * 2026-09-02 裁决「没有独立标题字段，标题从正文派生」。草稿提交口没有客户端参与标题，
 * 所以规则不能在两端各写一份：服务端这份是权威，`apps/web/components/feedback/
 * feedback-dialog.tsx` 的 `deriveFeedbackTitle` 只是预览——两者**逐字同一算法**：
 *
 *   ① 取第一行非空文本；② 在中/英文句末标点（。！？!?）处截第一句；③ 去首尾空白；
 *   ④ 截到 120 字（契约 `submitFeedback.in.title.max(120)`）。
 *
 * 空正文（全空白）⇒ `null`：`FeedbackDraft.title` 逐字「空正文时为 null」，
 * 而提交口在此之前已被 `DRAFT_EMPTY` 拦下，所以 `submitFeedbackDraft` 永远拿到的是 string。
 */
export const FEEDBACK_TITLE_MAX = 120;

export function deriveFeedbackTitle(detail: string): string | null {
  const firstLine = detail.trim().split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const firstSentence = firstLine.split(/[。！？!?]/)[0] ?? "";
  const picked = (firstSentence.trim() !== "" ? firstSentence : firstLine).trim();
  if (picked === "") return null;
  return picked.slice(0, FEEDBACK_TITLE_MAX);
}
