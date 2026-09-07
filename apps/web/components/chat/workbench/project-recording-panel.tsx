"use client";
import { ChatRecordingPanel } from "@/components/chat/chat-recording-panel";
/** Project recording keeps the existing consent, retention and persisted transcript API. */
export function ProjectRecordingPanel({ projectId, threadId, userId, bearer, canWrite, archived }: {
  projectId: string | null; threadId: string | null; userId: string | null;
  bearer: string | null; canWrite: boolean; archived: boolean;
}) {
  if (!projectId || !threadId || !userId || !bearer) return null;
  return <ChatRecordingPanel key={JSON.stringify([projectId, threadId, userId])} projectId={projectId} threadId={threadId} userId={userId} bearer={bearer} canRecord={canWrite && !archived} />;
}
