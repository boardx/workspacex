"use client";

import * as React from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { cn } from "@/lib/utils";

const SURVEY_SECTIONS = [
  { id: "surveys", label: "我的问卷", href: "/studio/survey", icon: FileText },
] as const;

export function SurveyAppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell previewRole={null} hideRoleSwitcher left={<SurveySectionNav />}>
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
  const activeSection = "surveys" as const;

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
              "flex items-center gap-2 rounded-md border-l-2 px-2 py-2 text-12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary bg-accent text-accent-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span className="flex-1">{section.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
