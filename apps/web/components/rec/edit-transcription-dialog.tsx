"use client";
import { StudioMetadataDialog, type HistoryMetadata } from "@/components/studio/studio-history-management";
export function EditTranscriptionDialog(props: { open: boolean; initialName: string; initialTags: readonly string[]; onOpenChange: (open: boolean) => void; onSave: (draft: HistoryMetadata) => void | Promise<void> }) {
  return <StudioMetadataDialog {...props} business="转录" prefix="rec" />;
}
