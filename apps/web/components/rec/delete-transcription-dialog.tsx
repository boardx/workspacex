"use client";
import { useI18n } from "@/lib/i18n/provider";
import { StudioDeleteDialog } from "@/components/studio/studio-history-management";
export function DeleteTranscriptionDialog(props: { open: boolean; name: string; onOpenChange: (open: boolean) => void; onConfirm: () => void | Promise<void> }) {
  const { t } = useI18n();
  return <StudioDeleteDialog {...props} business={t("rec.business")} prefix="rec" description={t("rec.deleteDescription")} />;
}
