"use client";
import { Button } from "@/components/ui/button";
export function QueueNextTurnAction({ visible, disabled, onQueue }: { visible: boolean; disabled: boolean; onQueue: () => void }) {
  if (!visible) return null;
  return <Button type="button" variant="ghost" size="sm" className="text-11" disabled={disabled} onClick={onQueue} data-testid="workbench-queue-next-turn">排到下一轮</Button>;
}
