"use client";
import Link from "next/link";
import { BarChart3, FileText, LayoutGrid } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

export type SurveyLibrarySection = "surveys" | "modules" | "reports";

const entries = [
  { id: "surveys", label: "survey.library.mySurveys", href: "/studio/survey", Icon: FileText },
  { id: "modules", label: "survey.library.questionTemplates", href: "/studio/survey?tab=modules", Icon: LayoutGrid },
  { id: "reports", label: "survey.library.reportTemplates", href: "/studio/survey?tab=reports", Icon: BarChart3 },
] as const;

export function SurveyLibraryNav({ active }: { active: SurveyLibrarySection }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t("survey.library.navigation")} className="survey-library-nav flex gap-2 overflow-x-auto border-b border-border bg-background pb-3">
      {entries.map(({ id, label, href, Icon }) => {
        const current = id === active;
        return (
          <Link key={id} aria-current={current ? "page" : undefined} className={`flex min-w-max items-center gap-3 rounded-lg px-4 py-3 text-14 transition-colors hover:bg-muted ${current ? "bg-muted font-medium" : ""}`} href={href}>
            <Icon aria-hidden="true" className="h-5 w-5" />
            {t(label)}
          </Link>
        );
      })}
    </nav>
  );
}
