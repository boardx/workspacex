"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useOptionalSession } from "@/components/session/session-provider";
import { readAidtStage } from "../lib/live-aidt-stages";
import { previewAidtText } from "../lib/aidt-print-preview";
import type { AidtUiStageDraft } from "../lib/aidt-ui-drafts";

/** Print a real saved formal artifact, without promoting an unsaved local draft. */
export function AidtSavedTextPrint({ projectId, stageId, label, draft, selectText, selectSavedDraft, artifactKey }: {
  projectId?: string; stageId: number; label: string; draft: AidtUiStageDraft;
  selectText: (value: AidtUiStageDraft) => string | null;
  selectSavedDraft?: (value: AidtUiStageDraft) => AidtUiStageDraft | null; artifactKey?: string;
}) {
  const session = useOptionalSession()?.session;
  const expected = selectText(draft);
  const scope = JSON.stringify([projectId, stageId, artifactKey, label, session?.currentOrgId, session?.userId, session?.sessionToken, expected]);
  const current = React.useRef(scope); current.current = scope;
  const alive = React.useRef(true);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  if (!projectId || !expected) return null;
  const print = async () => {
    if (!session?.sessionToken || busy) return;
    setBusy(true); setError("");
    const isCurrent = () => alive.current && current.current === scope;
    try {
      const { stage } = await readAidtStage(projectId, stageId, session.sessionToken);
      if (!isCurrent()) return;
      const saved = stage && (selectSavedDraft ? selectSavedDraft(stage.content.draft) : stage.content.draft);
      const text = saved && selectText(saved);
      if (!stage || !text || text !== expected) throw new Error("请先保存并确认当前产物，再打开打印预览。");
      await previewAidtText(text, `${label} · 第${stageId}步 V${stage.revision}`, { defaultPaper: "A4", isCurrent });
    } catch (failure) { if (isCurrent()) setError(failure instanceof Error ? failure.message : "无法打开已保存产物，请检查后重试。"); }
    finally { if (alive.current) setBusy(false); }
  };
  return <div className="space-y-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void print()}>{busy ? "正在读取…" : label}</Button>{error && <p role="alert" className="text-12 text-muted-foreground">{error}</p>}</div>;
}
