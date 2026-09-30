"use client";
/** CT10 —— Board 运行卡视图（全局；`?projectId=` 为项目视图）。只读投影，卡不可拖动。 */
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { WorkflowNav, WorkflowPage } from "@/components/workflow/workflow-nav";
import { LiveBoardRunColumns } from "@/components/work-stack/board-run-card";
import { listBoardRunCards } from "@/lib/board-run-cards-api";

function BoardRuns() {
  const projectId = useSearchParams().get("projectId");
  return (
    <WorkflowPage title={projectId ? "项目 Board · Workflow 运行" : "Board · Workflow 运行"}>
      <LiveBoardRunColumns projectId={projectId} load={listBoardRunCards} />
    </WorkflowPage>
  );
}

export default function WorkflowBoardPage() {
  return (
    <Suspense fallback={<p className="p-6 text-12 text-muted-foreground">加载中…</p>}>
      <BoardShell />
    </Suspense>
  );
}

function BoardShell() {
  const projectId = useSearchParams().get("projectId");
  return (
    <AppShell previewRole={null} left={<WorkflowNav active="board" projectId={projectId} />}>
      <BoardRuns />
    </AppShell>
  );
}
