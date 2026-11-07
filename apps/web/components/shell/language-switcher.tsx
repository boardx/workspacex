"use client";
import { useI18n } from "@/lib/i18n/provider";
import { isLocale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";
export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return <select aria-label={t("common.language")} value={locale} data-testid="language-switcher"
    onChange={(event) => { if (isLocale(event.target.value)) setLocale(event.target.value); }}
    className={cn("max-w-full rounded-control border border-border bg-card px-2 py-1 text-12 text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
    <option value="zh-CN" lang="zh-CN">简体中文</option><option value="en" lang="en">English</option>
  </select>;
}
