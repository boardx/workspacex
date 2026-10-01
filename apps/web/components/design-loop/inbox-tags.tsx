"use client";
import * as React from "react";
import { InlineTagEditor } from "@/components/ui/inline-tag-editor";
import { INBOX_TAG_MAX_LENGTH, INBOX_TAGS_MAX_COUNT } from "@/lib/live-inbox";

/**
 * 收件箱标签编辑器（2026-09-08 人类指令「card 要有 tags 的输入功能」+「整体界面上方要有 tags 过滤」）。
 *
 * 2026-09-30 起实现收敛到全仓共享的 `components/ui/inline-tag-editor.tsx`（项目卡同一份）；
 * 这里只填收件箱自己的契约上限（`INBOX_TAGS_MAX_COUNT` / `INBOX_TAG_MAX_LENGTH`）。
 * 看板卡片、列表行与 drawer 三处仍共用这一个导出，testid 约定不变。
 */
export function TagEditor(props: Omit<React.ComponentProps<typeof InlineTagEditor>, "maxTags" | "maxTagLength">) {
  return <InlineTagEditor {...props} maxTags={INBOX_TAGS_MAX_COUNT} maxTagLength={INBOX_TAG_MAX_LENGTH} />;
}
