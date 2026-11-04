"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RestoredInterruptForm } from "./restored-interrupt-form";
import { useDialogReturnFocus } from "./use-dialog-return-focus";
/** Mounted only for an authoritative permission request; closing never rejects it. */
export function InterruptDecisionDialog(props: React.ComponentProps<typeof RestoredInterruptForm>): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(true);
  const returnFocus = useDialogReturnFocus(open);
  const isFillParams = props.interrupt.toolName === "fill_run_params";
  return <>
    <Button variant="outline" onClick={() => setOpen(true)}>{isFillParams ? t("chatPermissions.openFill") : t("chatPermissions.openPending")}</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="overflow-y-auto overscroll-contain"
        data-testid="chat-tool-permission-dialog"
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={returnFocus}
      >
        <DialogTitle>{props.interrupt.toolName === "confirm_task_intent" ? t("chatPermissions.confirmIntent") : isFillParams ? t("chatPermissions.waitingInput") : t("chatPermissions.confirmationNeeded")}</DialogTitle>
        <DialogDescription>{isFillParams ? t("chatPermissions.fillDescription") : t("chatPermissions.closeDescription")}</DialogDescription>
        <RestoredInterruptForm {...props} />
      </DialogContent>
    </Dialog>
  </>;
}
