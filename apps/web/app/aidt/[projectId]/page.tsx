import styles from "./step-actions.module.css";
import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { notFound } from "next/navigation";
import { isAidtModuleEnabled } from "@/lib/aidt-module-config";
export default async function AidtProjectPage({ params }: { params: { projectId: string } }) {
  if (!isAidtModuleEnabled()) notFound();
  const { AidtProjectWorkspace } = await import("@/features/aidt/entry/workspace");
  return <AppShell previewRole={null} fullscreen><div className={styles.workspace}><Suspense fallback={null}><AidtProjectWorkspace projectId={params.projectId} /></Suspense></div></AppShell>;
}
