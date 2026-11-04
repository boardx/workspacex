import type { Locale } from "@/lib/i18n/locale";
export const reportNumber = (value: number, locale: Locale = "zh-CN") =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);

export const REPORT_COLORS = ["#237c74", "#548bc1", "#b58b46", "#8c78ad", "#ce7663"];

/** Canonical fallback identity; live legends may format its display text. */
export const SURVEY_CHART_DEFAULT_SERIES = "数据";
