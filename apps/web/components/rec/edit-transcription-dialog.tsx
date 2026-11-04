"use client";
import { useI18n } from "@/lib/i18n/provider";
import { tagInputLimits, personalRealtimeTranscription } from "@repo/contracts";
import { StudioMetadataDialog, type HistoryMetadata } from "@/components/studio/studio-history-management";
export function EditTranscriptionDialog(props: { open: boolean; initialName: string; initialTags: readonly string[]; onOpenChange: (open: boolean) => void; onSave: (draft: HistoryMetadata) => void | Promise<void> }) {
  const { t } = useI18n();
  return <StudioMetadataDialog tagLimits={tagInputLimits(personalRealtimeTranscription.operations.updatePersonalTranscriptionMetadata.in.shape.tags)} {...props} business={t("rec.business")} prefix="rec" />;
}
