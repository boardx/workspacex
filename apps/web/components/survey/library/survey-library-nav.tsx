import Link from "next/link";
import { BarChart3, FileText, LayoutGrid } from "lucide-react";

export type SurveyLibrarySection = "surveys" | "modules" | "reports";

const entries = [
  { id: "surveys", label: "我的问卷", href: "/studio/survey", Icon: FileText },
  { id: "modules", label: "问卷模板", href: "/studio/survey?tab=modules", Icon: LayoutGrid },
  { id: "reports", label: "报告模板", href: "/studio/survey?tab=reports", Icon: BarChart3 },
] as const;

export function SurveyLibraryNav({ active }: { active: SurveyLibrarySection }) {
  return (
    <nav aria-label="问卷二级导航" className="survey-library-nav flex gap-2 overflow-x-auto rounded-xl border border-border bg-card p-3 lg:flex-col lg:self-start">
      {entries.map(({ id, label, href, Icon }) => {
        const current = id === active;
        return (
          <Link key={id} aria-current={current ? "page" : undefined} className={`flex min-w-max items-center gap-3 rounded-lg px-4 py-3 text-14 transition-colors hover:bg-muted ${current ? "bg-muted font-medium" : ""}`} href={href}>
            <Icon aria-hidden="true" className="h-5 w-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
