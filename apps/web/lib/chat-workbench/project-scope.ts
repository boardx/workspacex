import { createPersonalThread, createThread, listPersonalThreads, listThreads } from "@/lib/live-chat";
export function workbenchThreadPath(threadId: string | null, projectId: string | null): string {
  const path = threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat";
  return projectId ? `${path}?projectId=${encodeURIComponent(projectId)}` : path;
}
export function createWorkbenchThread(projectId: string | null) {
  return projectId ? createThread({ projectId, groupId: null, title: "新对话", visibilityScope: "private" }) : createPersonalThread(null);
}
export function listWorkbenchThreads(projectId: string | null, bearer: string, signal?: AbortSignal) {
  return projectId ? listThreads(projectId, {}, bearer, signal) : listPersonalThreads({}, bearer, signal);
}
