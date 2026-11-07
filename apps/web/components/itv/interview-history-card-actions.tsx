"use client";
import { useI18n } from "@/lib/i18n/provider";
import { tagInputLimits, interview } from "@repo/contracts";
import { StudioHistoryManagement } from "@/components/studio/studio-history-management";
import { deleteDigitalInterview, updateDigitalInterviewMetadata, type DigitalInterviewHistoryRow } from "@/lib/interview-api";
import { deleteMockDigitalInterviewDraft, updateMockDigitalInterviewMetadata } from "@/lib/mock/digital-interview-drafts";
export function InterviewHistoryCardActions({ item, onChanged }: { item: DigitalInterviewHistoryRow; onChanged: () => void }) {
  const { t } = useI18n();
  const mock = item.interviewId.startsWith("mock-batch-");
  if (!mock && !item.canManage) return null;
  return <StudioHistoryManagement tagLimits={tagInputLimits(interview.operations.updateDigitalInterviewMetadata.in.shape.tags)} business={t("itv.business")} prefix="itv" id={item.interviewId} name={item.name} tags={item.tags}
    deleteDescription={mock ? t("itv.history.deletePreview") : t("itv.history.deleteSaved")}
    onSave={async draft => { if (mock) updateMockDigitalInterviewMetadata(item.interviewId, { name: draft.name, tags: [...draft.tags] }); else await updateDigitalInterviewMetadata(item.interviewId, { name: draft.name, tags: [...draft.tags] }); onChanged(); }}
    onDelete={async () => { if (mock) deleteMockDigitalInterviewDraft(item.interviewId); else await deleteDigitalInterview(item.interviewId); onChanged(); }} />;
}
