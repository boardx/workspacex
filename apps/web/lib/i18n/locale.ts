import { SUPPORTED_LOCALES, type Locale } from "@repo/contracts/locale";
export { SUPPORTED_LOCALES, type Locale } from "@repo/contracts/locale";
export const DEFAULT_LOCALE: Locale = "zh-CN";
export const LOCALE_COOKIE = "workspacex-locale";
export function isLocale(value: unknown): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}
export function resolveLocale(value: unknown, host?: string | null): Locale {
  if (isLocale(value)) return value;
  return /^app\.workspacex\.us(?::\d+)?$/i.test(host ?? "") ? "en" : DEFAULT_LOCALE;
}
