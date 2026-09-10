"use client";
import { StudioDeleteDialog } from "@/components/studio/studio-history-management";
export function DeleteTranscriptionDialog(props: { open: boolean; name: string; onOpenChange: (open: boolean) => void; onConfirm: () => void | Promise<void> }) {
  return <StudioDeleteDialog {...props} business="转录" prefix="rec" description="的正文和全部录音批次将永久删除，且无法恢复。" />;
}
