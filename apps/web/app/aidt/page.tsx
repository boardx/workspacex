import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { notFound } from "next/navigation";
import { isAidtModuleEnabled } from "@/lib/aidt-module-config";
export default async function AidtPage() {
  if (!isAidtModuleEnabled()) notFound();
  const { AidtHome } = await import("@/features/aidt/entry/home");
  return <AppShell previewRole={null} fullscreen><Suspense fallback={null}><AidtHome /></Suspense></AppShell>;
}
