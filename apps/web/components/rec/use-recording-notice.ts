"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { MessageKey, MessageParams } from "@/lib/i18n/messages";

type RecordingNotice = { key: MessageKey; params?: MessageParams; translatedParams?: Record<string, MessageKey> };
/** Store semantics so an already visible preview notice follows the display locale. */
export function useRecordingNotice() {
  const { t } = useI18n();
  const [notice, setNotice] = React.useState<RecordingNotice | null>(null);
  return [notice ? t(notice.key, { ...notice.params, ...Object.fromEntries(Object.entries(notice.translatedParams ?? {}).map(([name, key]) => [name, t(key)])) }) : null, setNotice] as const;
}
