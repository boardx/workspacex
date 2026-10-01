"use client";
import * as React from "react";
import { SurveyCreateCommandSchema, SurveyRuntimeSchema, type SurveyRuntime } from "@repo/contracts/survey-runtime";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { surveyRequest } from "@/lib/survey/runtime-client";
export function SurveyDraftCopy({ runtime, onCreated, disabled }: { runtime: SurveyRuntime; onCreated: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const lock = React.useRef(false);
  async function copy() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const command = SurveyCreateCommandSchema.parse({ anonymity: runtime.anonymity, draft: {
        title: `${runtime.title.slice(0, 194)}（新草稿）`, tags: runtime.tags,
        questions: structuredClone(runtime.publication?.questions ?? runtime.questions),
        template: structuredClone(runtime.template),
      } });
      const created = await surveyRequest("/surveys", { method: "POST", body: command }, SurveyRuntimeSchema);
      setOpen(false); onCreated(created.id);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "创建失败，请重试"); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!lock.current) { setOpen(value); setError(""); } }}>
    <DialogTrigger asChild><Button type="button" variant="outline" disabled={disabled}>复制为新草稿</Button></DialogTrigger>
    <DialogContent>
      <DialogTitle>从已发布问卷创建新草稿</DialogTitle>
      <DialogDescription>复制已发布题目、标签和当前报告模板。新草稿独立保存，可重新设计和发布；旧问卷链接、回收状态与历史答卷保持不变，不会迁移答卷。</DialogDescription>
      {error && <p role="alert" className="text-13 text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>取消</Button><Button type="button" disabled={busy} onClick={() => void copy()}>{busy ? "正在创建…" : "确认创建新草稿"}</Button></div>
    </DialogContent>
  </Dialog>;
}
