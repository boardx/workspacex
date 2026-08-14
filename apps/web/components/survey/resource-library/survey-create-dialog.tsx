"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ClipboardList, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SURVEY_QUESTION_MODULE_CARDS } from "@/lib/survey/resource-library";
import {
  normalizeSurveyCreationDraft,
  type SurveyCreationDraft,
} from "@/lib/survey/creation-draft";

export type SurveyCreationMode = "blank" | "module";

export function SurveyCreateDialog({ open, mode, onOpenChange, onCreate }: {
  open: boolean;
  mode: SurveyCreationMode;
  onOpenChange: (open: boolean) => void;
  onCreate: (draft: SurveyCreationDraft) => void;
}) {
  const [step, setStep] = React.useState<"metadata" | "module">("metadata");
  const [draft, setDraft] = React.useState<SurveyCreationDraft>({ name: "", tags: [] });
  const [tagInput, setTagInput] = React.useState("");

  const reset = React.useCallback(() => {
    setStep("metadata");
    setDraft({ name: "", tags: [] });
    setTagInput("");
  }, []);

  React.useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const commitTag = () => {
    const values = tagInput.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
    if (values.length > 0) {
      setDraft((current) => ({ ...current, tags: [...new Set([...current.tags, ...values])] }));
    }
    setTagInput("");
  };

  const normalized = normalizeSurveyCreationDraft(draft);
  const submitMetadata = (event: React.FormEvent) => {
    event.preventDefault();
    if (!normalized) return;
    if (mode === "module") {
      setDraft(normalized);
      setStep("module");
      return;
    }
    onCreate(normalized);
  };

  const submitModule = () => {
    const result = normalizeSurveyCreationDraft(draft);
    if (!result?.sourceModuleId) return;
    onCreate(result);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-background-foreground/35 backdrop-blur-sm" />
        <Dialog.Content data-testid="survey-create-dialog" className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-7 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-20 font-semibold">{step === "metadata" ? mode === "blank" ? "新建问卷" : "从问卷模块新建" : "选择问卷模块"}</Dialog.Title>
              <Dialog.Description className="mt-2 text-12 text-muted-foreground">
                {step === "metadata" ? "填写问卷名称与标签，再进入问卷设计。" : "选择一个模块作为问卷题目的起点，之后可独立修改。"}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild><Button type="button" variant="ghost" size="icon" aria-label="关闭创建问卷弹窗"><X className="h-4 w-4" /></Button></Dialog.Close>
          </div>

          {step === "metadata" ? (
            <form onSubmit={submitMetadata} className="mt-7 grid gap-6">
              <div className="grid gap-2">
                <Label htmlFor="survey-create-name">问卷名称</Label>
                <Input id="survey-create-name" autoFocus maxLength={100} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="例如：季度协作健康度调查" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="survey-create-tag-input">标签（可选）</Label>
                <div className="flex min-h-14 flex-wrap items-center gap-2 rounded-lg border border-input p-2">
                  {draft.tags.map((tag) => (
                    <span key={tag} data-testid="survey-create-tag" className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-11">
                      {tag}
                      <button type="button" aria-label={`删除标签 ${tag}`} onClick={() => setDraft((current) => ({ ...current, tags: current.tags.filter((value) => value !== tag) }))} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  <Input id="survey-create-tag-input" value={tagInput} onChange={(event) => setTagInput(event.target.value)} onBlur={commitTag} onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "," || event.key === "，") {
                      event.preventDefault();
                      commitTag();
                    }
                  }} placeholder="输入标签，按回车或逗号添加" className="min-w-48 flex-1 border-0 shadow-none focus-visible:ring-0" />
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" size="lg" onClick={close}>取消</Button>
                <Button type="submit" variant="primary" size="lg" disabled={!normalized}>{mode === "module" ? "下一步" : "创建问卷"}</Button>
              </div>
            </form>
          ) : (
            <div className="mt-6">
              <div className="grid gap-3 sm:grid-cols-2">
                {SURVEY_QUESTION_MODULE_CARDS.map((module) => {
                  const selected = draft.sourceModuleId === module.id;
                  return (
                    <button key={module.id} type="button" aria-pressed={selected} onClick={() => setDraft((current) => ({ ...current, sourceModuleId: module.id }))} className={`rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary bg-accent" : "border-border hover:border-primary"}`}>
                      <span className="flex items-center justify-between gap-3"><ClipboardList className="h-5 w-5 text-primary" />{selected && <Check className="h-4 w-4 text-primary" />}</span>
                      <span className="mt-3 block text-13 font-semibold">{module.title}</span>
                      <span className="mt-1 block text-11 text-muted-foreground">{module.description} · {module.questionCount} 题</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <Button type="button" variant="outline" size="lg" onClick={() => setStep("metadata")}>返回上一步</Button>
                <Button type="button" variant="primary" size="lg" disabled={!draft.sourceModuleId} onClick={submitModule}>使用所选模块创建</Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
