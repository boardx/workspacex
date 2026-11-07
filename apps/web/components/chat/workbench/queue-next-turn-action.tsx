"use client";
import { useI18n } from "@/lib/i18n/provider";
import { Button } from "@/components/ui/button";
export function QueueNextTurnAction({ visible, disabled, onQueue }: { visible: boolean; disabled: boolean; onQueue: () => void }) {
  const { t } = useI18n();
  if (!visible) return null;
  return <Button type="button" variant="ghost" size="sm" className="text-11" disabled={disabled} onClick={onQueue} data-testid="workbench-queue-next-turn">{t("chatInteractions.queueNext")}</Button>;
}
