"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChartNoAxesCombined, ClipboardList, FileText } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { mockIdentity } from "@/lib/identity";
import {
  SURVEY_LIBRARY_CARDS,
  SURVEY_QUESTION_MODULE_CARDS,
  SURVEY_TEMPLATE_CARDS,
} from "@/lib/survey/resource-library";
import { cn } from "@/lib/utils";

const SURVEY_SECTIONS = [
  { id: "surveys", label: "问卷列表", href: "/studio/survey", icon: FileText, count: SURVEY_LIBRARY_CARDS.length },
  { id: "modules", label: "问卷模块", href: "/studio/survey?tab=modules", icon: ClipboardList, count: SURVEY_QUESTION_MODULE_CARDS.length },
  { id: "reports", label: "报告模块", href: "/studio/survey?tab=reports", icon: ChartNoAxesCombined, count: SURVEY_TEMPLATE_CARDS.length },
] as const;

export function SurveyAppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell identity={mockIdentity("org-yuanyang", null)} previewRole={null} hideRoleSwitcher left={<SurveySectionNav />}>
      {children}
    </AppShell>
  );
}

function SurveySectionNav() {
  return (
    <React.Suspense fallback={<SurveySectionNavContent activeSection={null} />}>
      <SurveySectionNavWithLocation />
    </React.Suspense>
  );
}

function SurveySectionNavWithLocation() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSection = pathname.startsWith("/studio/survey/templates")
    ? "reports"
    : searchParams.get("mode") === "module" || searchParams.get("tab") === "modules"
      ? "modules"
      : searchParams.get("tab") === "reports"
        ? "reports"
        : "surveys";

  return <SurveySectionNavContent activeSection={activeSection} />;
}

function SurveySectionNavContent({ activeSection }: { activeSection: (typeof SURVEY_SECTIONS)[number]["id"] | null }) {
  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Survey 资源类型" data-testid="survey-section-nav">
      <span className="px-1 pb-2 text-10 uppercase tracking-wide text-muted-foreground">Survey</span>
      {SURVEY_SECTIONS.map((section) => {
        const Icon = section.icon;
        const active = activeSection === section.id;
        return (
          <Link
            key={section.id}
            href={section.href}
            aria-current={active ? "page" : undefined}
            data-testid={`survey-section-nav-${section.id}`}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-2 text-12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span className="flex-1">{section.label}</span>
            <Badge tone="outline">{section.count}</Badge>
          </Link>
        );
      })}
    </nav>
  );
}
