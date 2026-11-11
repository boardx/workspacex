"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/provider";
import { getBoard, updateBoard, type Board } from "@/lib/live-whiteboard";

export function ProjectBoardNameEditor({ boardId, onSaved }: {
  boardId: string;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [board, setBoard] = React.useState<Board | null>(null);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<"load" | "save" | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setBoard(null);
    setError(null);
    void getBoard(boardId).then((result) => {
      if (!active) return;
      setBoard(result);
      setName(result.name);
    }).catch(() => { if (active) setError("load"); });
    return () => { active = false; };
  }, [boardId, open]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const nextName = name.trim();
    if (saving || board?.role !== "owner" || !nextName || nextName === board.name) return;
    setSaving(true);
    setError(null);
    try {
      await updateBoard(boardId, { name: nextName });
      setOpen(false);
      onSaved();
    } catch {
      setError("save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={t("projectResources.editBoard")} data-testid={`project-board-edit-${boardId}`}>
          <Pencil aria-hidden className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t("projectResources.editBoard")}</DialogTitle>
        <DialogDescription>{t("projectResources.editBoardHelp")}</DialogDescription>
        {error === "load" ? <p role="alert">{t("projectResources.boardLoadFailed")}</p>
          : board === null ? <p role="status">{t("projectResources.contentLoading")}</p>
          : board.role !== "owner" ? <p role="status">{t("projectResources.boardOwnerOnly")}</p>
          : (
            <form className="space-y-3" onSubmit={(event) => void save(event)}>
              <label className="block space-y-1">
                <span>{t("projectResources.boardName")}</span>
                <Input autoFocus value={name} maxLength={200} disabled={saving} onChange={(event) => setName(event.target.value)} />
              </label>
              {error === "save" && <p role="alert">{t("projectResources.boardSaveFailed")}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
                <Button type="submit" variant="primary" disabled={saving || !name.trim() || name.trim() === board.name}>{t("common.save")}</Button>
              </DialogFooter>
            </form>
          )}
      </DialogContent>
    </Dialog>
  );
}
