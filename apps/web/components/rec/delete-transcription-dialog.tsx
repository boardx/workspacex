"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";

export function DeleteTranscriptionDialog({ open, name, onOpenChange, onConfirm }: { open: boolean; name: string;
  onOpenChange: (open: boolean) => void; onConfirm: () => void | Promise<void> }) {
  const [deleting, setDeleting] = React.useState(false); const [failed, setFailed] = React.useState(false);
  async function confirm() { if (deleting) return; setDeleting(true); setFailed(false); try { await onConfirm(); onOpenChange(false); } catch { setFailed(true); } finally { setDeleting(false); } }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-40 bg-background-foreground/35 backdrop-blur-sm" /><Dialog.Content data-testid="rec-delete-dialog" className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-7 shadow-lg"><Dialog.Title className="text-18 font-semibold">永久删除转录？</Dialog.Title><Dialog.Description className="mt-3 text-13 text-muted-foreground">“{name}”的正文和全部录音批次将永久删除，且无法恢复。</Dialog.Description>{failed && <p role="alert" className="mt-3 text-12 text-destructive">删除失败，请稍后重试。</p>}<div className="mt-6 flex justify-end gap-3"><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button data-testid="rec-delete-confirm" variant="destructive" disabled={deleting} onClick={() => void confirm()}>{deleting ? "删除中" : "永久删除"}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
