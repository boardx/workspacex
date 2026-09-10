"use client";
import { StudioHistoryManagement } from "@/components/studio/studio-history-management";
import { deleteDigitalInterview, updateDigitalInterviewMetadata, type DigitalInterviewHistoryRow } from "@/lib/interview-api";
import { deleteMockDigitalInterviewDraft, updateMockDigitalInterviewMetadata } from "@/lib/mock/digital-interview-drafts";
export function InterviewHistoryCardActions({ item, onChanged }: { item: DigitalInterviewHistoryRow; onChanged: () => void }) {
  const mock = item.interviewId.startsWith("mock-batch-");
  if (!mock && !item.canManage) return null;
  return <StudioHistoryManagement business="访谈" prefix="itv" id={item.interviewId} name={item.name} tags={item.tags}
    deleteDescription={mock ? "的预览内容将删除，且不可恢复。" : "将从首页移除，关联报告和访谈记录将保留。"}
    onSave={async draft => { if (mock) updateMockDigitalInterviewMetadata(item.interviewId, { name: draft.name, tags: [...draft.tags] }); else await updateDigitalInterviewMetadata(item.interviewId, { name: draft.name, tags: [...draft.tags] }); onChanged(); }}
    onDelete={async () => { if (mock) deleteMockDigitalInterviewDraft(item.interviewId); else await deleteDigitalInterview(item.interviewId); onChanged(); }} />;
}
