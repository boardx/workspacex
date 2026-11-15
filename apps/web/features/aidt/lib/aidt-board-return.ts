import { safeChatHostReturnHref } from "@/lib/chat/chat-host-navigation";
import { AIDT_STEPS, aidtHref } from "./project-aidt";

/** A navigation hint only; neither a Board role nor project membership is inferred. */
export function aidtBoardReturnHref({ projectId, boardId, returnTo, aidtStep, aidtThread }: {
  projectId: string | null | undefined;
  boardId: string | null | undefined;
  returnTo?: string | null;
  aidtStep?: string | null;
  aidtThread?: string | null;
}): string | null {
  if (!projectId?.trim() || !boardId?.trim()) return null;
  let stage = aidtStep;
  let thread = aidtThread;
  if (returnTo !== null && returnTo !== undefined) {
    const safe = safeChatHostReturnHref(returnTo);
    if (!safe) return null;
    const target = new URL(safe, "https://workspace.invalid");
    if (target.pathname !== `/aidt/${encodeURIComponent(projectId)}` || target.hash || target.searchParams.getAll("step").length !== 1 || target.searchParams.getAll("thread").length > 1) return null;
    stage = target.searchParams.get("step");
    thread = target.searchParams.get("thread");
  }
  const step = AIDT_STEPS.find((item) => String(item.id) === stage);
  if (!step) return null;
  // Rebuild a canonical URL rather than forwarding untrusted query parameters.
  // The resource comes from the actual Board route, never returnTo's resource.
  return aidtHref(projectId, step.id, { tool: "whiteboard", resource: boardId, thread });
}
