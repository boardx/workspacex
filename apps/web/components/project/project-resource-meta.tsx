"use client";
import { useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { formatRelativeTime } from "@/lib/home-format";

/** 「更新于 3 分钟前」——悬停显示精确日期；解析不了时间就退回原来的日期文本。 */
export function UpdatedAt({ iso }: { iso: string }): JSX.Element {
  const { locale, t } = useI18n();
  const rel = formatRelativeTime(iso, undefined, locale);
  return <time dateTime={iso} title={formatDate(iso, locale)}>{t("projectResources.updated", { date: rel ?? formatDate(iso, locale) })}</time>;
}

export function formatDate(iso: string, locale?: Locale): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString(locale);
}
