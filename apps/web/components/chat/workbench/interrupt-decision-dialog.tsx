"use client";
import * as React from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RestoredInterruptForm } from "./restored-interrupt-form";
/** Mounted only for an authoritative permission request; closing never rejects it. */
export function InterruptDecisionDialog(props: React.ComponentProps<typeof RestoredInterruptForm>): JSX.Element {
  const [open, setOpen] = React.useState(true);
  const isFillParams = props.interrupt.toolName === "fill_run_params";
  return <>
    <Button variant="outline" onClick={() => setOpen(true)}>{isFillParams ? "继续补充信息" : "打开待确认请求"}</Button>
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogContent className="overflow-y-auto overscroll-contain" onInteractOutside={(event) => event.preventDefault()}>
        <DialogTitle>{props.interrupt.toolName === "confirm_task_intent" ? "确认任务意图" : isFillParams ? "等待你补充信息" : "任务需要你的确认"}</DialogTitle>
        <DialogDescription>{isFillParams ? "任务已暂停。补充这些信息后，Agent 会从当前步骤继续。" : "可以暂时关闭并继续补充要求；关闭不会提交或拒绝此次请求。"}</DialogDescription>
        <RestoredInterruptForm {...props} />
      </DialogContent>
    </Dialog>
  </>;
}
