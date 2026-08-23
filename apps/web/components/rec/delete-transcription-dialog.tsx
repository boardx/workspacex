"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

export function DeleteTranscriptionDialog({ open, name, onOpenChange, onConfirm }: { open: boolean; name: string;
  onOpenChange: (open: boolean) => void; onConfirm: () => void | Promise<void> }) {
  const [deleting, setDeleting] = React.useState(false); const [failed, setFailed] = React.useState(false);
  async function confirm() { if (deleting) return; setDeleting(true); setFailed(false); try { await onConfirm(); onOpenChange(false); } catch { setFailed(true); } finally { setDeleting(false); } }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="rec-delete-dialog" closeTestId="rec-delete-dialog-close" className="max-w-sm p-7">
        <DialogTitle className="text-18">永久删除转录？</DialogTitle>
        <DialogDescription className="mt-3 text-13">“{name}”的正文和全部录音批次将永久删除，且无法恢复。</DialogDescription>
        {failed && <p role="alert" className="mt-3 text-12 text-destructive">删除失败，请稍后重试。</p>}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button data-testid="rec-delete-confirm" variant="destructive" disabled={deleting} onClick={() => void confirm()}>{deleting ? "删除中" : "永久删除"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
