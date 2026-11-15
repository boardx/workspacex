"use client";
import { useParams, useSearchParams } from "next/navigation";
import { isAidtModuleEnabled } from "@/features/aidt/lib/aidt-module-config";
import { aidtBoardReturnHref } from "@/features/aidt/lib/aidt-board-return";
import { ProjectBreadcrumb } from "@/components/project/project-breadcrumb";
/** Navigation context never grants Board access; LiveBoard retains its own guard. */
export function AidtBoardReturn() {
  const search = useSearchParams();
  const params = useParams<{ boardId?: string | string[] }>();
  if (!isAidtModuleEnabled()) return null;
  const projectId = search.get("projectId");
  const boardId = typeof params?.boardId === "string" ? params.boardId : null;
  if (search.getAll("returnTo").length > 1 || search.getAll("aidtStep").length > 1) return null;
  const href = aidtBoardReturnHref({ projectId, boardId, returnTo: search.get("returnTo"), aidtStep: search.get("aidtStep"), aidtThread: search.get("aidtThread") ?? search.get("thread") });
  if (!href) return null;
  return <ProjectBreadcrumb projectId={projectId} sub="whiteboard" hrefOverride={href} labelOverride="返回 AIDT 步骤" />;
}
