"use client";

import { AppShell } from "@/components/shell/app-shell";

export function SurveyAppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell previewRole={null} hideRoleSwitcher>
      {children}
    </AppShell>
  );
}
