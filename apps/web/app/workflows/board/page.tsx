"use client";
/** CT10 —— Board 运行卡视图（全局；`?projectId=` 为项目视图）。只读投影，卡不可拖动。 */
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { WorkflowNav } from "@/components/workflow/workflow-nav";
import { LiveBoardRunColumns } from "@/components/work-stack/board-run-card";
import { listBoardRunCards } from "@/lib/board-run-cards-api";

function BoardRuns() {
  const projectId = useSearchParams().get("projectId");
  return (
    <>
      <h1>{projectId ? "项目 Board · Workflow 运行" : "Board · Workflow 运行"}</h1>
      <LiveBoardRunColumns projectId={projectId} load={listBoardRunCards} />
    </>
  );
}

export default function WorkflowBoardPage() {
  return (
    <AppShell previewRole={null} left={<WorkflowNav active="board" />}>
      <Suspense fallback={<p>加载中…</p>}>
        <BoardRuns />
      </Suspense>
    </AppShell>
  );
}
